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
   DESIGN TOKENS  — light theme, all solid colours (no alpha hex)
   pptxgenjs does NOT support 8-char hex (RRGGBBAA) — alpha kills
   the colour and renders black. Every fill must be 6-char hex.
───────────────────────────────────────────────────────────── */
const T = {
  // Backgrounds
  bg:      "F0F4FA",   // page bg — light blue-grey
  surface: "FFFFFF",
  border:  "D1D9E6",
  bdMd:    "A8B8CF",
  altRow:  "F7F9FC",

  // Text
  text:    "111827",
  textMd:  "374151",
  textSm:  "6B7280",

  // Header
  h1: "2563EB",
  h2: "7C3AED",

  // Semantic colours (6-char solid only)
  blue:     "2563EB",  blueLt:   "DBEAFE",
  green:    "059669",  greenBg:  "D1FAE5",  greenBd: "6EE7B7",
  amber:    "D97706",  amberBg:  "FEF3C7",  amberBd: "FCD34D",
  red:      "DC2626",  redBg:    "FEE2E2",  redBd:   "FCA5A5",
  violet:   "7C3AED",  violetBg: "EDE9FE",  violetBd:"C4B5FD",
  orange:   "EA580C",
  teal:     "0891B2",

  // Phase accents
  phaseAccents: [
    "2563EB","059669","D97706","7C3AED","EA580C","0891B2",
  ] as const,
  phaseAccentBgs: [
    "EFF6FF","D1FAE5","FEF3C7","EDE9FE","FFF7ED","E0F2FE",
  ] as const,

  // Pre-mixed light tints (replaces accent + alpha)
  accentTints: [
    "C7D9FA","A7E4C8","FDE9A2","D4C5F9","F9C9A8","A5D8E8",
  ] as const,

  // Status colours
  status: {
    on_track: "059669",
    at_risk:  "D97706",
    delayed:  "DC2626",
    done:     "7C3AED",
    default:  "94A3B8",
  } as Record<string, string>,

  statusBg: {
    on_track: "D1FAE5",
    at_risk:  "FEF3C7",
    delayed:  "FEE2E2",
    done:     "EDE9FE",
    default:  "F1F5F9",
  } as Record<string, string>,

  // Pre-mixed progress tints (replaces sColor + "44" alpha)
  statusProgBg: {
    on_track: "86EFAC",
    at_risk:  "FDE68A",
    delayed:  "FCA5A5",
    done:     "C4B5FD",
    default:  "CBD5E1",
  } as Record<string, string>,

  today: "2563EB",

  // Column alt tint (replaces "00000009")
  colAlt: "E8EEF5",

  // Progress bar track (replaces "00000015")
  pbTrack: "E2E8F0",

  // Badge bg (replaces "FFFFFFAA")
  badgeBg: "FFFFFF",
} as const;

/* ─────────────────────────────────────────────────────────────
   STATUS HELPERS
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

function inferProgress(item: any): number {
  const p = item?.progress;
  if (typeof p === "number" && Number.isFinite(p)) return clamp01(p > 1 ? p / 100 : p);
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

export async function renderSchedulePptx(args: RenderSchedulePptxArgs): Promise<Buffer> {
  const title         = args.title || "Project Roadmap";
  const viewStart     = args.viewStart ?? null;
  const viewEnd       = args.viewEnd   ?? null;
  const weeksPerSlide = Math.max(1, Math.min(12, Number(args.weeksPerSlide ?? 8) || 8));

  const schedule = normalizeSchedule(args.contentJson);
  const phases   = schedule.phases;
  const items    = schedule.items;

  const { minDate, maxDate } = clampWindowInclusive(items);

  const timeWindows: TimeWindow[] =
    viewStart && viewEnd
      ? (() => {
          const s   = startOfWeekUTC(startOfDayUTC(viewStart));
          const eEx = addDaysUTC(startOfWeekUTC(addDaysUTC(startOfDayUTC(viewEnd), 7)), 7);
          return [{ start: s, endExclusive: eEx, weekSegs: buildWeekSegments(s, eEx), label: "" }];
        })()
      : buildTimeWindowsWeekly(minDate, maxDate, weeksPerSlide);

  /* ── PPTX init ── */
  const pptx    = new PptxGenJS();
  pptx.layout   = "LAYOUT_WIDE";
  pptx.author   = "Project Management System";
  pptx.subject  = title;
  pptx.title    = title;

  /* ── Slide dimensions ── */
  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;

  /* ── Layout ── */
  const M          = 0.32;
  const SIDE_W     = 2.6;
  const TL_X       = M + SIDE_W;
  const TL_W       = SLIDE_W - TL_X - M;

  const HDR_H      = 0.72;
  const WK_HDR_H   = 0.52;
  const CONTENT_Y  = HDR_H + WK_HDR_H + 0.06;
  const CONTENT_BOT = SLIDE_H - M - 0.28;

  const PH_HDR_H   = 0.46;
  const LANE_H     = 0.42;
  const BAR_H      = 0.22;
  const MS_SZ      = 0.18;
  const PH_GAP     = 0.06;

  const FONT = "Segoe UI";

  const slides: any[] = [];
  function newSlide() {
    const s = pptx.addSlide();
    s.background = { color: T.bg };
    slides.push(s);
    return s;
  }

  /* ── Per-window header ── */
  function addPageHeader(slide: any, win: TimeWindow, pxPerDay: number) {
    // Header bar — solid blue
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: SLIDE_W, h: HDR_H,
      fill: { color: T.h1 },
      line: { color: T.h1, width: 0 },
    });
    // Violet accent (right 28%)
    slide.addShape(pptx.ShapeType.rect, {
      x: SLIDE_W * 0.72, y: 0, w: SLIDE_W * 0.28, h: HDR_H,
      fill: { color: T.h2 },
      line: { color: T.h2, width: 0 },
    });
    slide.addText(title, {
      x: M, y: 0, w: SLIDE_W * 0.6, h: HDR_H,
      fontSize: 18, bold: true, color: "FFFFFF",
      valign: "middle", fontFace: FONT,
    });
    slide.addText("SCHEDULE / ROADMAP", {
      x: SLIDE_W - M - 2.4, y: 0, w: 2.3, h: HDR_H,
      fontSize: 8, bold: true, color: "E0E7FF",
      align: "right", valign: "middle", fontFace: FONT,
    });

    // Week header strip
    const wkY = HDR_H;
    slide.addShape(pptx.ShapeType.rect, {
      x: TL_X, y: wkY, w: TL_W, h: WK_HDR_H,
      fill: { color: "E4EAF4" },
      line: { color: T.bdMd, width: 0.75 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: M, y: wkY, w: SIDE_W, h: WK_HDR_H,
      fill: { color: "E4EAF4" },
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

      if (alt) {
        slide.addShape(pptx.ShapeType.rect, {
          x: sx, y: wkY, w: sw, h: WK_HDR_H,
          fill: { color: "D8E0EE" },  // solid — was DDE3EE
          line: { color: T.border, width: 0 },
        });
      }
      slide.addText(seg.label, {
        x: sx + 0.04, y: wkY + 0.04, w: sw - 0.08, h: 0.22,
        fontSize: 9, bold: true, color: T.text,
        align: "center", valign: "middle", fontFace: FONT,
      });
      slide.addText(seg.dateRange, {
        x: sx + 0.04, y: wkY + 0.26, w: sw - 0.08, h: 0.16,
        fontSize: 7, color: T.textSm,
        align: "center", valign: "middle", fontFace: FONT,
      });
      slide.addShape(pptx.ShapeType.line, {
        x: sx, y: wkY, w: 0, h: WK_HDR_H,
        line: { color: T.border, width: 0.5 },
      });
    });

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

  /* ── Legend ── */
  function addLegend(slide: any) {
    const lY  = HDR_H + WK_HDR_H + 0.01;
    const lH  = 0.22;
    const lX  = TL_X + 0.1;
    const gap = 1.0;

    [
      { shape: "diamond",  color: T.amber,  label: "Milestone"   },
      { shape: "circle",   color: T.blue,   label: "Task"        },
      { shape: "square",   color: T.violet, label: "Deliverable" },
    ].forEach(({ shape, color, label }, i) => {
      const ix = lX + i * gap;
      if (shape === "diamond") {
        slide.addShape(pptx.ShapeType.diamond, {
          x: ix, y: lY + 0.05, w: 0.1, h: 0.1,
          fill: { color }, line: { color, width: 1 },
        });
      } else if (shape === "circle") {
        slide.addShape(pptx.ShapeType.ellipse, {
          x: ix, y: lY + 0.06, w: 0.09, h: 0.09,
          fill: { color }, line: { color, width: 0 },
        });
      } else {
        slide.addShape(pptx.ShapeType.rect, {
          x: ix, y: lY + 0.06, w: 0.09, h: 0.09,
          fill: { color }, line: { color, width: 0 },
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
      const phase     = phases[pIdx];
      const accent    = T.phaseAccents[pIdx % T.phaseAccents.length];
      const acBg      = T.phaseAccentBgs[pIdx % T.phaseAccentBgs.length];
      const acTint    = T.accentTints[pIdx % T.accentTints.length];  // light strip tint

      const phVisible = items.filter((it) => {
        if (it.phaseId !== phase.id) return false;
        const e = it.end ?? it.start;
        return e >= win.start && it.start < win.endExclusive;
      });

      const allPhItems = items.filter((it) => it.phaseId === phase.id);
      const donePct    = allPhItems.length
        ? Math.round(allPhItems.filter((i) => statusKey(i.status) === "done").length / allPhItems.length * 100)
        : 0;

      const blockH = PH_HDR_H + phVisible.length * LANE_H + PH_GAP;

      if (curY + blockH > CONTENT_BOT && curY > CONTENT_Y + 0.4) {
        slide = newSlide();
        addPageHeader(slide, win, pxPerDay);
        addLegend(slide);
        curY = CONTENT_Y;
      }

      /* ── Phase header ── */
      slide.addShape(pptx.ShapeType.rect, {
        x: M, y: curY, w: SIDE_W, h: PH_HDR_H,
        fill: { color: acBg },
        line: { color: accent, width: 0.5 },
      });
      // Left accent bar
      slide.addShape(pptx.ShapeType.rect, {
        x: M, y: curY, w: 0.05, h: PH_HDR_H,
        fill: { color: accent },
        line: { color: accent, width: 0 },
      });
      slide.addText(phase.name, {
        x: M + 0.14, y: curY, w: SIDE_W - 0.5, h: PH_HDR_H,
        fontSize: 11, bold: true, color: T.text,
        valign: "middle", fontFace: FONT,
      });
      // Badge background — solid white (was FFFFFFAA)
      slide.addShape(pptx.ShapeType.roundRect, {
        x: M + SIDE_W - 0.38, y: curY + 0.12, w: 0.28, h: PH_HDR_H - 0.24,
        fill: { color: T.badgeBg },
        line: { color: accent, width: 0.75 },
      });
      slide.addText(String(allPhItems.length), {
        x: M + SIDE_W - 0.38, y: curY + 0.12, w: 0.28, h: PH_HDR_H - 0.24,
        fontSize: 8, bold: true, color: accent,
        align: "center", valign: "middle", fontFace: FONT,
      });

      // Timeline phase header
      slide.addShape(pptx.ShapeType.rect, {
        x: TL_X, y: curY, w: TL_W, h: PH_HDR_H,
        fill: { color: acBg },
        line: { color: accent, width: 0.5 },
      });

      // Progress bar track — solid (was "00000015")
      const pbX = TL_X + 0.2;
      const pbW = Math.min(TL_W * 0.5, 2.4);
      const pbY = curY + PH_HDR_H * 0.5 - 0.04;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pbX, y: pbY, w: pbW, h: 0.06,
        fill: { color: T.pbTrack },
        line: { color: T.border, width: 0.5 },
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

      /* ── Swim lanes ── */
      const sorted = [...phVisible].sort((a, b) => a.start.getTime() - b.start.getTime());

      sorted.forEach((item, ii) => {
        const isAlt  = ii % 2 !== 0;
        const rowBg  = isAlt ? T.altRow : T.surface;
        const sk     = statusKey(item.status);
        const sColor = T.status[sk]      ?? T.status.default;
        const sBg    = T.statusBg[sk]    ?? T.statusBg.default;
        const sProgBg = T.statusProgBg[sk] ?? T.statusProgBg.default;
        const sLabel = STATUS_LABELS[sk] ?? "—";

        // Sidebar row
        slide.addShape(pptx.ShapeType.rect, {
          x: M, y: curY, w: SIDE_W, h: LANE_H,
          fill: { color: rowBg },
          line: { color: T.border, width: 0.5 },
        });
        // Left accent strip — solid pre-mixed tint (was accent + "55")
        slide.addShape(pptx.ShapeType.rect, {
          x: M, y: curY, w: 0.04, h: LANE_H,
          fill: { color: acTint },
          line: { color: acTint, width: 0 },
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

        // Timeline lane bg
        slide.addShape(pptx.ShapeType.rect, {
          x: TL_X, y: curY, w: TL_W, h: LANE_H,
          fill: { color: rowBg },
          line: { color: T.border, width: 0.5 },
        });

        // Alternating column tints — solid (was "00000009")
        win.weekSegs.forEach((seg, si) => {
          if (si % 2 === 0) return;
          const sx = xOf(seg.start);
          const ex = xOf(seg.endExclusive);
          slide.addShape(pptx.ShapeType.rect, {
            x: sx, y: curY, w: Math.max(0.01, ex - sx), h: LANE_H,
            fill: { color: T.colAlt },
            line: { color: T.border, width: 0 },
          });
        });

        /* ── Bar / milestone ── */
        const s    = item.start < win.start ? win.start : item.start;
        const eRaw = item.end ?? item.start;
        const e    = eRaw >= win.endExclusive ? addDaysUTC(win.endExclusive, -1) : eRaw;
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
          const stripeW = 0.05;

          // Bar fill
          slide.addShape(pptx.ShapeType.roundRect, {
            x: bx, y: by, w: bw, h: BAR_H,
            fill: { color: sBg },
            line: { color: sColor, width: 1.5 },
          });

          // Left accent stripe
          slide.addShape(pptx.ShapeType.roundRect, {
            x: bx, y: by, w: Math.min(stripeW, bw), h: BAR_H,
            fill: { color: sColor },
            line: { color: sColor, width: 0 },
          });

          // Progress fill — pre-mixed tint (was sColor + "44")
          const prog = inferProgress(item);
          if (prog > 0 && bw > 0.1) {
            slide.addShape(pptx.ShapeType.roundRect, {
              x: bx, y: by, w: Math.min(Math.max(stripeW, bw * prog), bw), h: BAR_H,
              fill: { color: sProgBg },
              line: { color: T.surface, width: 0 },
            });
          }

          // Bar label
          if (bw >= 0.6) {
            slide.addText(item.name, {
              x: bx + stripeW + 0.06, y: by,
              w: bw - stripeW - 0.1, h: BAR_H,
              fontSize: 8, color: sColor,
              valign: "middle", fontFace: FONT,
            });
          }
        }

        curY += LANE_H;
      });

      // Phase separator line
      slide.addShape(pptx.ShapeType.line, {
        x: M, y: curY, w: SLIDE_W - M * 2, h: 0,
        line: { color: T.bdMd, width: 1 },
      });

      curY += PH_GAP;
    }
  }

  /* ── Footer ── */
  slides.forEach((s, idx) => {
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: SLIDE_H - 0.28, w: SLIDE_W, h: 0.28,
      fill: { color: T.text },
      line: { color: T.h1, width: 1 },
    });

    [
      { label: "On Track", col: T.green  },
      { label: "At Risk",  col: T.amber  },
      { label: "Delayed",  col: T.red    },
      { label: "Done",     col: T.violet },
    ].forEach(({ label, col }, i) => {
      const fx = M + i * 1.5;
      s.addShape(pptx.ShapeType.ellipse, {
        x: fx, y: SLIDE_H - 0.195, w: 0.09, h: 0.09,
        fill: { color: col }, line: { color: col, width: 0 },
      });
      s.addText(label, {
        x: fx + 0.14, y: SLIDE_H - 0.28, w: 1.2, h: 0.28,
        fontSize: 7, color: "CCDDFF",
        valign: "middle", fontFace: FONT,
      });
    });

    s.addText(`${idx + 1} / ${slides.length}`, {
      x: SLIDE_W - M - 0.7, y: SLIDE_H - 0.28, w: 0.6, h: 0.28,
      fontSize: 8, color: "99AABB",
      align: "right", valign: "middle", fontFace: FONT,
    });
  });

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(
    buffer instanceof Blob ? await buffer.arrayBuffer() : (buffer as ArrayBuffer)
  );
}