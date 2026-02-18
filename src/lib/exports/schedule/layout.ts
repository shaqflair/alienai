import type { Item, LaneAssignment, TimeWindow, WeekSeg } from "./types";
import { addDaysUTC, daysBetweenUTC, fmtDateShortUTC, startOfDayUTC, startOfWeekUTC } from "./utils";

/* ---------------- lanes ---------------- */

/**
 * Calculates vertical positioning for tasks.
 * Ensures that overlapping tasks are assigned to different "lanes"
 * so they don't collide visually.
 */
export function assignLanes(items: Item[]): LaneAssignment {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const laneEnds: Date[] = [];
  const laneOf: Record<string, number> = {};

  for (const it of sorted) {
    const s = it.start;
    const e = it.end ?? it.start;

    let laneIdx = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      // If this lane ended before the current task starts, we can reuse it
      if (laneEnds[i].getTime() <= s.getTime()) {
        laneIdx = i;
        break;
      }
    }
    if (laneIdx === -1) {
      laneIdx = laneEnds.length;
      laneEnds.push(e);
    } else {
      laneEnds[laneIdx] = e;
    }
    laneOf[it.id] = laneIdx;
  }

  return { laneOf, lanesCount: laneEnds.length };
}

/* ---------------- week segments ---------------- */

export function buildWeekSegments(rangeStart: Date, rangeEndExclusive: Date): WeekSeg[] {
  const segs: WeekSeg[] = [];
  let cur = startOfWeekUTC(rangeStart);
  let weekNum = 1;

  while (cur < rangeEndExclusive) {
    const next = addDaysUTC(cur, 7);
    const segStart = cur < rangeStart ? rangeStart : cur;
    const segEnd = next > rangeEndExclusive ? rangeEndExclusive : next;

    const startStr = fmtDateShortUTC(segStart);
    const endStr = fmtDateShortUTC(addDaysUTC(segEnd, -1));

    segs.push({
      start: segStart,
      endExclusive: segEnd,
      label: `W${weekNum}`,
      dateRange: `${startStr} - ${endStr}`,
    });

    cur = next;
    weekNum++;
  }

  return segs;
}

/**
 * Groups weeks into "Time Windows" (e.g., 4 weeks per slide/page).
 */
export function buildTimeWindowsWeekly(minDate: Date, maxDate: Date, weeksPerSlide: number): TimeWindow[] {
  const start = startOfWeekUTC(minDate);
  const endEx = addDaysUTC(startOfWeekUTC(addDaysUTC(maxDate, 7)), 7);

  const weeks: Date[] = [];
  for (let d = new Date(start); d < endEx; d = addDaysUTC(d, 7)) weeks.push(new Date(d));

  const windows: TimeWindow[] = [];
  for (let i = 0; i < weeks.length; i += weeksPerSlide) {
    const winStart = weeks[i];
    const winEndEx = i + weeksPerSlide < weeks.length ? weeks[i + weeksPerSlide] : endEx;
    const segs = buildWeekSegments(winStart, winEndEx);
    const label =
      segs.length > 0
        ? `${segs[0].dateRange.split(" - ")[0]} – ${segs[segs.length - 1].dateRange.split(" - ")[1]}`
        : "";
    windows.push({ start: winStart, endExclusive: winEndEx, weekSegs: segs, label });
  }

  return windows.length ? windows : [{ start, endExclusive: endEx, weekSegs: buildWeekSegments(start, endEx), label: "" }];
}

/* ---------------- range helpers ---------------- */

export function clampWindowInclusive(items: Item[]): { minDate: Date; maxDate: Date } {
  let minDate = new Date(Date.UTC(2100, 0, 1));
  let maxDate = new Date(Date.UTC(1970, 0, 1));

  for (const it of items) {
    const s = it.start;
    const e = it.end ?? it.start;
    if (s < minDate) minDate = s;
    if (e > maxDate) maxDate = e;
  }

  // Fallback for empty/invalid data
  if (!Number.isFinite(minDate.getTime()) || !Number.isFinite(maxDate.getTime()) || minDate.getTime() > maxDate.getTime()) {
    const now = startOfDayUTC(new Date());
    const s = startOfWeekUTC(now);
    return { minDate: s, maxDate: addDaysUTC(s, 56) }; // Default 8-week window
  }

  return { minDate, maxDate };
}

export function windowDays(rangeStart: Date, rangeEndExclusive: Date) {
  return Math.max(1, daysBetweenUTC(rangeStart, rangeEndExclusive));
}
