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
  buildTimeWindowsWeekly,
  buildWeekSegments,
  clampWindowInclusive,
} from "./layout";

/* ─────────────────────────────────────────────────────────────
   DESIGN TOKENS  — matches ScheduleGanttEditor vivid palette
───────────────────────────────────────────────────────────── */
const T = {
  // Backgrounds
  bg:      "EEF1F7",
  surface: "FFFFFF",
  border:  "CDD3DF",
  bdMd:    "A8B3C8",
  altRow:  "F8FAFB",

  // Text
  text:   "111827",
  textMd: "374151",
  textSm: "6B7280",

  // Brand / header gradient
  h1: "2563EB",   // blue-600
  h2: "7C3AED",   // violet-600

  // Type colours
  blue:     "2563EB", blueLt:   "DBEAFE",
  green:    "059669", greenBg:  "D1FAE5", greenBd: "6EE7B7",
  amber:    "D97706", amberBg:  "FEF3C7", amberBd: "FCD34D",
  red:      "DC2626", redBg:    "FEE2E2", redBd:   "FCA5A5",
  violet:   "7C3AED", violetBg: "EDE9FE", violetBd:"C4B5FD",
  orange:   "EA580C",
  teal:     "0891B2",

  // Phase accents (cycling)
  phaseAccents: [
    "2563EB","059669","D97706","7C3AED","EA580C","0891B2",
  ] as const,
  phaseAccentBgs: [
    "EFF6FF","D1FAE5","FEF3C7","EDE9FE","FFF7ED","E0F2FE",
  ] as const,

  // Status
  status: {
    on_track: "059669",
    at_risk:  "D97706",
    delayed:  "DC2626",
    done:     "7C3AED",
    default:  "94A3B8",
  } as Record<string, string>,

  // Status backgrounds
  statusBg: {
    on_track: "D1FAE5",
    at_risk:  "FEF3C7",
    delayed:  "FEE2E2",
    done:     "EDE9FE",
    default:  "F1F5F9",
  } as Record<string, string>,

  today: "2563EB",
} as const;

/* ─────────────────────────────────────────────────────────────
   STATUS LABEL
───────────────────────────────────────────────────────────── */
const STATUS_LABELS: Record<string, string> = {
  on_track: "On Track",
  at_risk:  "At Risk",
  delayed:  "Delayed",
  done:     "Done",
};

function statusKey(raw: string): string {
  const s = String(raw || "").toLowerCase().replace(/[\s-]/g, "_");
  return s in T.status ? s : "default";
}

/* ─────────────────────────────────────────────────────────────
   PROGRESS HELPER
───────────────────────────────────────────────────────────── */
function inferProgress(item: any): number {
  const p = item?.progress;
  if (typeof p === "number" && Number.isFinite(p)) {
    return clamp01(p > 1 ? p / 100 : p);
  }
  const s = statusKey(item?.status || "");
  if (s === "done")     return 1;
  if (s === "delayed")  return 0.3;
  if (s === "at_risk")  return 0.55;
  if (s === "on_track") return 0.7;
  return 0.5;
}

/* ─────────────────────────────────────────────────────────────
   EXPORTED API
───────────────────────────────────────────────────────────── */
export type RenderSchedulePptxArgs = {
  title?: string;
  pmName?: string;
  contentJson: any;
  viewStart?: Date | null;
  viewEnd?:   Date | null;
  weeksPerSlide?: number;
};

export async function renderSchedulePptx(
  args: RenderSchedulePptxArgs
): Promise<Buffer> {
  const title        = args.title || "Project Roadmap";
  const viewStart    = args.viewStart ?? null;
  const viewEnd      = args.viewEnd   ?? null;
  const weeksPerSlide = Math.max(1, Math.min(12, Number(args.weeksPerSlide ?? 8) || 8));

  const schedule = normalizeSchedule(args.contentJson);
  const phases   = schedule.phases;
  const items    = schedule.items;

  const { minDate, maxDate } = clampWindowInclusive(items);

  const timeWindows: TimeWindow[] =
    viewStart && viewEnd
      ? (() => {
          const s    = startOfWeekUTC(startOfDayUTC(viewStart));
          const eEx  = addDaysUTC(startOfWeekUTC(addDaysUTC(startOfDayUTC(viewEnd), 7)), 7);
          const segs = buildWeekSegments(s, eEx);
          return [{ start: s, endExclusive: eEx, weekSegs: segs, label: "" }];
        })()
      : buildTimeWindowsWeekly(minDate, maxDate, weeksPerSlide);

  /* ── PPTX boilerplate ── */
  const pptx       = new PptxGenJS();
  pptx.layout      = "LAYOUT_WIDE";
  pptx.author      = "Project Management System";
  pptx.company     = "";
  pptx.subject     = title;
  pptx.title       = title;

  /* ── Slide dimensions ── */
  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;

  /* ── Layout constants (swim-lane style) ── */
  const M          = 0.32;                          // outer margin
  const SIDE_W     = 2.6;                           // sidebar (name + status)
  const TL_X       = M + SIDE_W;                    // timeline start X
  const TL_W       = SLIDE_W - TL_X - M;            // timeline width

  const HDR_H      = 0.72;                          // gradient header strip
  const WK_HDR_H   = 0.52;                          // week column headers
  const CONTENT_Y  = HDR_H + WK_HDR_H + 0.06;      // first row starts here
  const CONTENT_BOT = SLIDE_H - M - 0.28;           // footer top

  const PH_HDR_H   = 0.46;                          // phase header row
  const LANE_H     = 0.42;                          // item swim lane height
  const BAR_H      = 0.22;                          // Gantt bar height
  const MS_SZ      = 0.18;                          // milestone diamond size
  const PH_GAP     = 0.06;                          // gap between phases

  const FONT       = "Segoe UI";

  /* ── Slide factory ── */
  const slides: any[] = [];
  function newSlide() {
    const s = pptx.addSlide();
    s.background = { color: T.bg };
    slides.push(s);
    return s;
  }

  /* ── Per-window header (gradient strip + week columns) ── */
  function addPageHeader(slide: any, win: TimeWindow, pxPerDay: number) {
    // ── Gradient header bar ──
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: SLIDE_W, h: HDR_H,
      fill: { type: "solid", color: T.h1 },   // pptxgenjs doesn't support gradients natively, use flat brand blue
      line: { color: T.h1, width: 0 },
    });

    // Accent stripe right edge (violet overlay)
    slide.addShape(pptx.ShapeType.rect, {
      x: SLIDE_W * 0.72, y: 0, w: SLIDE_W * 0.28, h: HDR_H,
      fill: { type: "solid", color: T.h2 },
      line: { color: T.h2, width: 0 },
    });

    // Title
    slide.addText(title, {
      x: M, y: 0, w: SLIDE_W * 0.6, h: HDR_H,
      fontSize: 18, bold: true, color: "FFFFFF",
      valign: "middle", fontFace: FONT,
    });

    // Label badge (top right)
    slide.addText("SCHEDULE / ROADMAP", {
      x: SLIDE_W - M - 2.4, y: 0, w: 2.4 - 0.1, h: HDR_H,
      fontSize: 8, bold: true, color: "FFFFFFBB",
      align: "right", valign: "middle", fontFace: FONT,
    });

    // ── Week column header strip ──
    const wkY = HDR_H;
    slide.addShape(pptx.ShapeType.rect, {
      x: TL_X, y: wkY, w: TL_W, h: WK_HDR_H,
      fill: { color: "E4E9F2" },
      line: { color: T.bdMd, width: 0.75 },
    });

    // Sidebar label header
    slide.addShape(pptx.ShapeType.rect, {
      x: M, y: wkY, w: SIDE_W, h: WK_HDR_H,
      fill: { color: "E4E9F2" },
      line: { color: T.bdMd, width: 0.75 },
    });
    slide.addText("PHASE / ITEM", {
      x: M + 0.12, y: wkY, w: SIDE_W - 0.2, h: WK_HDR_H,
      fontSize: 7, bold: true, color: T.textSm,
      valign: "middle", fontFace: FONT,
    });

    win.weekSegs.forEach((seg, idx) => {
      const sx  = TL_X + daysBetweenUTC(win.start, seg.start) * pxPerDay;
      const ex  = TL_X + daysBetweenUTC(win.start, seg.endExclusive) * pxPerDay;
      const sw  = Math.max(0.04, ex - sx);
      const alt = idx % 2 !== 0;

      // Alt column tint
      if (alt) {
        slide.addShape(pptx.ShapeType.rect, {
          x: sx, y: wkY, w: sw, h: WK_HDR_H,
          fill: { color: "DDE3EE" },
          line: { color: T.border, width: 0 },
        });
      }

      // Week label
      slide.addText(seg.label, {
        x: sx + 0.04, y: wkY + 0.04, w: sw - 0.08, h: 0.22,
        fontSize: 9, bold: true, color: T.text,
        align: "center", valign: "middle", fontFace: FONT,
      });

      // Date range
      slide.addText(seg.dateRange, {
        x: sx + 0.04, y: wkY + 0.26, w: sw - 0.08, h: 0.16,
        fontSize: 7, color: T.textSm,
        align: "center", valign: "middle", fontFace: FONT,
      });

      // Vertical grid line
      slide.addShape(pptx.ShapeType.line, {
        x: sx, y: wkY, w: 0, h: WK_HDR_H,
        line: { color: T.border, width: 0.5 },
      });
    });

    // Closing grid line
    const lastX = TL_X + daysBetweenUTC(win.start, win.endExclusive) * pxPerDay;
    slide.addShape(pptx.ShapeType.line, {
      x: lastX, y: wkY, w: 0, h: WK_HDR_H,
      line: { color: T.border, width: 0.5 },
    });

    // Today line
    const today = startOfDayUTC(new Date());
    if (today >= win.start && today < win.endExclusive) {
      const tx = TL_X + daysBetweenUTC(win.start, today) * pxPerDay;
      slide.addShape(pptx.ShapeType.line, {
        x: tx, y: wkY, w: 0, h: CONTENT_BOT - wkY,
        line: { color: T.today, width: 1.2, dashType: "dash" },
      });
      slide.addText("TODAY", {
        x: tx - 0.3, y: wkY + WK_HDR_H + 0.02, w: 0.6, h: 0.13,
        fontSize: 7, bold: true, color: T.today,
        align: "center", valign: "middle", fontFace: FONT,
      });
    }
  }

  /* ── Legend row (bottom of header area) ── */
  function addLegend(slide: any) {
    const lY  = HDR_H + WK_HDR_H + 0.01;
    const lH  = 0.22;
    const lX  = TL_X + 0.1;
    const gap = 1.0;

    const items = [
      { shape: "diamond",  color: T.amber,  label: "Milestone"    },
      { shape: "circle",   color: T.blue,   label: "Task"         },
      { shape: "square",   color: T.violet, label: "Deliverable"  },
    ];

    items.forEach(({ shape, color, label }, i) => {
      const ix = lX + i * gap;
      if (shape === "diamond") {
        slide.addShape(pptx.ShapeType.diamond, {
          x: ix, y: lY + 0.05, w: 0.1, h: 0.1,
          fill: { color }, line: { color, width: 1 },
        });
      } else if (shape === "circle") {
        slide.addShape(pptx.ShapeType.ellipse, {
          x: ix, y: lY + 0.06, w: 0.09, h: 0.09,
          fill: { color }, line: { color: color, width: 0 },
        });
      } else {
        slide.addShape(pptx.ShapeType.rect, {
          x: ix, y: lY + 0.06, w: 0.09, h: 0.09,
          fill: { color }, line: { color: color, width: 0 },
        });
      }
      slide.addText(label, {
        x: ix + 0.14, y: lY, w: 0.8, h: lH,
        fontSize: 8, color: T.textMd,
        valign: "middle", fontFace: FONT,
      });
    });
  }

  /* ────────────────────────────────────────────────────────────
     MAIN RENDER LOOP
  ──────────────────────────────────────────────────────────── */
  for (let wIdx = 0; wIdx < timeWindows.length; wIdx++) {
    const win       = timeWindows[wIdx];
    const totalDays = Math.max(1, daysBetweenUTC(win.start, win.endExclusive));
    const pxPerDay  = TL_W / totalDays;

    function xOf(d: Date) {
      return TL_X + daysBetweenUTC(win.start, d) * pxPerDay;
    }

    let slide = newSlide();
    addPageHeader(slide, win, pxPerDay);
    addLegend(slide);

    let curY = CONTENT_Y;

    for (let pIdx = 0; pIdx < phases.length; pIdx++) {
      const phase  = phases[pIdx];
      const accent = T.phaseAccents[pIdx % T.phaseAccents.length];
      const acBg   = T.phaseAccentBgs[pIdx % T.phaseAccentBgs.length];

      // Items visible in this time window
      const phVisible = items.filter((it) => {
        if (it.phaseId !== phase.id) return false;
        const s = it.start;
        const e = it.end ?? it.start;
        return e >= win.start && s < win.endExclusive;
      });

      const allPhItems = items.filter((it) => it.phaseId === phase.id);
      const donePct    = allPhItems.length
        ? Math.round(allPhItems.filter((i) => statusKey(i.status) === "done").length / allPhItems.length * 100)
        : 0;

      const blockH = PH_HDR_H + phVisible.length * LANE_H + PH_GAP;

      // Page break
      if (curY + blockH > CONTENT_BOT && curY > CONTENT_Y + 0.4) {
        slide = newSlide();
        addPageHeader(slide, win, pxPerDay);
        addLegend(slide);
        curY = CONTENT_Y;
      }

      /* ── Phase header row ── */
      // Left sidebar — accent bg
      slide.addShape(pptx.ShapeType.rect, {
        x: M, y: curY, w: SIDE_W, h: PH_HDR_H,
        fill: { color: acBg },
        line: { color: accent, width: 0.5 },
      });
      // Left accent bar (5px equivalent)
      slide.addShape(pptx.ShapeType.rect, {
        x: M, y: curY, w: 0.05, h: PH_HDR_H,
        fill: { color: accent },
        line: { color: accent, width: 0 },
      });
      // Phase name
      slide.addText(phase.name, {
        x: M + 0.14, y: curY, w: SIDE_W - 0.5, h: PH_HDR_H,
        fontSize: 11, bold: true, color: T.text,
        valign: "middle", fontFace: FONT,
      });
      // Item count badge
      slide.addShape(pptx.ShapeType.roundRect, {
        x: M + SIDE_W - 0.38, y: curY + 0.12, w: 0.28, h: PH_HDR_H - 0.24,
        fill: { color: "FFFFFFAA" },
        line: { color: accent, width: 0.75 },
      });
      slide.addText(String(allPhItems.length), {
        x: M + SIDE_W - 0.38, y: curY + 0.12, w: 0.28, h: PH_HDR_H - 0.24,
        fontSize: 8, bold: true, color: accent,
        align: "center", valign: "middle", fontFace: FONT,
      });

      // Timeline area — accent bg
      slide.addShape(pptx.ShapeType.rect, {
        x: TL_X, y: curY, w: TL_W, h: PH_HDR_H,
        fill: { color: acBg },
        line: { color: accent, width: 0.5 },
      });

      // Progress bar track
      const pbX = TL_X + 0.2;
      const pbW = Math.min(TL_W * 0.5, 2.4);
      const pbY = curY + PH_HDR_H * 0.5 - 0.04;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pbX, y: pbY, w: pbW, h: 0.06,
        fill: { color: "00000015" },
        line: { color: "00000008", width: 0.5 },
      });
      if (donePct > 0) {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: pbX, y: pbY, w: pbW * donePct / 100, h: 0.06,
          fill: { color: accent },
          line: { color: accent, width: 0 },
        });
      }
      slide.addText(`${donePct}%`, {
        x: pbX + pbW + 0.1, y: curY, w: 0.4, h: PH_HDR_H,
        fontSize: 8, bold: true, color: accent,
        valign: "middle", fontFace: FONT,
      });

      curY += PH_HDR_H;

      /* ── Swim lanes — one per item ── */
      const sorted = [...phVisible].sort(
        (a, b) => a.start.getTime() - b.start.getTime()
      );

      sorted.forEach((item, ii) => {
        const isAlt  = ii % 2 !== 0;
        const rowBg  = isAlt ? T.altRow : T.surface;
        const sk     = statusKey(item.status);
        const sColor = T.status[sk]  ?? T.status.default;
        const sBg    = T.statusBg[sk] ?? T.statusBg.default;
        const sLabel = STATUS_LABELS[sk] ?? "—";

        // Row background — sidebar
        slide.addShape(pptx.ShapeType.rect, {
          x: M, y: curY, w: SIDE_W, h: LANE_H,
          fill: { color: rowBg },
          line: { color: T.border, width: 0.5 },
        });
        // Left accent strip
        slide.addShape(pptx.ShapeType.rect, {
          x: M, y: curY, w: 0.04, h: LANE_H,
          fill: { color: `${accent}55` },
          line: { color: `${accent}22`, width: 0 },
        });

        // Type icon
        const iconCx = M + 0.16;
        const iconCy = curY + LANE_H / 2;
        if (item.type === "milestone") {
          slide.addShape(pptx.ShapeType.diamond, {
            x: iconCx - 0.06, y: iconCy - 0.06, w: 0.12, h: 0.12,
            fill: { color: T.amber },
            line: { color: T.amberBd, width: 1 },
          });
        } else if (item.type === "deliverable") {
          slide.addShape(pptx.ShapeType.rect, {
            x: iconCx - 0.055, y: iconCy - 0.055, w: 0.11, h: 0.11,
            fill: { color: T.violet },
            line: { color: T.violetBd, width: 0.75 },
          });
        } else {
          slide.addShape(pptx.ShapeType.ellipse, {
            x: iconCx - 0.055, y: iconCy - 0.055, w: 0.11, h: 0.11,
            fill: { color: T.blue },
            line: { color: T.blue, width: 0 },
          });
        }

        // Item name
        slide.addText(item.name, {
          x: M + 0.32, y: curY, w: SIDE_W - 0.78, h: LANE_H,
          fontSize: 9, color: T.text,
          valign: "middle", fontFace: FONT,
          charSpacing: 0,
        });

        // Status pill
        slide.addShape(pptx.ShapeType.roundRect, {
          x: M + SIDE_W - 0.62, y: curY + LANE_H * 0.28, w: 0.54, h: LANE_H * 0.44,
          fill: { color: sBg },
          line: { color: sColor, width: 0.75 },
        });
        slide.addText(sLabel, {
          x: M + SIDE_W - 0.62, y: curY + LANE_H * 0.28, w: 0.54, h: LANE_H * 0.44,
          fontSize: 7, bold: true, color: sColor,
          align: "center", valign: "middle", fontFace: FONT,
        });

        // Timeline lane background
        slide.addShape(pptx.ShapeType.rect, {
          x: TL_X, y: curY, w: TL_W, h: LANE_H,
          fill: { color: rowBg },
          line: { color: T.border, width: 0.5 },
        });

        // Alternating column tints
        win.weekSegs.forEach((seg, si) => {
          if (si % 2 === 0) return;
          const sx = xOf(seg.start);
          const ex = xOf(seg.endExclusive);
          slide.addShape(pptx.ShapeType.rect, {
            x: sx, y: curY, w: Math.max(0.01, ex - sx), h: LANE_H,
            fill: { color: "00000009" },
            line: { color: T.border, width: 0 },
          });
        });

        // ── Bar / milestone ──
        const s = item.start < win.start ? win.start : item.start;
        const eRaw  = item.end ?? item.start;
        const e = eRaw >= win.endExclusive ? addDaysUTC(win.endExclusive, -1) : eRaw;

        const barCY = curY + LANE_H / 2;

        if (item.type === "milestone") {
          const mx = xOf(s);
          slide.addShape(pptx.ShapeType.diamond, {
            x: mx - MS_SZ / 2, y: barCY - MS_SZ / 2,
            w: MS_SZ, h: MS_SZ,
            fill: { color: T.amber },
            line: { color: T.amberBd, width: 1.5 },
          });
        } else {
          const bx  = xOf(s);
          const ex2 = xOf(addDaysUTC(e, 1));
          const bw  = Math.max(0.18, ex2 - bx);
          const by  = barCY - BAR_H / 2;

          // Bar fill (status-tinted)
          slide.addShape(pptx.ShapeType.roundRect, {
            x: bx, y: by, w: bw, h: BAR_H,
            fill: { color: sBg },
            line: { color: sColor, width: 1.5 },
          });

          // Left accent stripe on bar
          const stripeW = 0.05;
          slide.addShape(pptx.ShapeType.roundRect, {
            x: bx, y: by, w: Math.min(stripeW, bw), h: BAR_H,
            fill: { color: sColor },
            line: { color: sColor, width: 0 },
          });

          // Progress fill
          const prog = inferProgress(item);
          if (prog > 0 && bw > 0.1) {
            const progW = Math.max(stripeW, bw * prog);
            slide.addShape(pptx.ShapeType.roundRect, {
              x: bx, y: by, w: Math.min(progW, bw), h: BAR_H,
              fill: { color: `${sColor}44` },
              line: { color: "FFFFFF00", width: 0 },
            });
          }

          // Label (inside bar or after)
          const minInside = 0.6;
          if (bw >= minInside) {
            slide.addText(item.name, {
              x: bx + stripeW + 0.06, y: by,
              w: bw - stripeW - 0.1, h: BAR_H,
              fontSize: 8, color: sColor, bold: false,
              valign: "middle", fontFace: FONT,
            });
          }
        }

        curY += LANE_H;
      });

      // Phase bottom border line
      slide.addShape(pptx.ShapeType.line, {
        x: M, y: curY, w: SLIDE_W - M * 2, h: 0,
        line: { color: T.bdMd, width: 1 },
      });

      curY += PH_GAP;
    }
  }

  /* ── Footer ── */
  slides.forEach((s, idx) => {
    // Footer bar
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: SLIDE_H - 0.28, w: SLIDE_W, h: 0.28,
      fill: { color: T.text },
      line: { color: T.h1, width: 1 },
    });

    // Status legend in footer
    const statuses = [
      { k: "on_track", label: "On Track",  col: T.green  },
      { k: "at_risk",  label: "At Risk",   col: T.amber  },
      { k: "delayed",  label: "Delayed",   col: T.red    },
      { k: "done",     label: "Done",      col: T.violet },
    ];
    statuses.forEach(({ label, col }, i) => {
      const fx = M + i * 1.5;
      s.addShape(pptx.ShapeType.ellipse, {
        x: fx, y: SLIDE_H - 0.195, w: 0.09, h: 0.09,
        fill: { color: col },
        line: { color: col, width: 0 },
      });
      s.addText(label, {
        x: fx + 0.14, y: SLIDE_H - 0.28, w: 1.2, h: 0.28,
        fontSize: 7, color: "FFFFFF99",
        valign: "middle", fontFace: FONT,
      });
    });

    // Slide number
    s.addText(`${idx + 1} / ${slides.length}`, {
      x: SLIDE_W - M - 0.7, y: SLIDE_H - 0.28, w: 0.6, h: 0.28,
      fontSize: 8, color: "FFFFFF66",
      align: "right", valign: "middle", fontFace: FONT,
    });
  });

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(
    buffer instanceof Blob ? await buffer.arrayBuffer() : (buffer as ArrayBuffer)
  );
}