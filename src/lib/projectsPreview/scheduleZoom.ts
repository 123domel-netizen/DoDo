/** Timeline zoom: day stays the data/snap unit; dayPx is only visual scale. */

export const DAY_PX_MIN = 2;
export const DAY_PX_MAX = 64;
export const DAY_PX_DEFAULT = 32;

/** Default board scale: ~one month in the viewport. */
export const DEFAULT_VISIBLE_DAYS = 30;

/** Fit / default: keep this many days before today at the left of the view. */
export const FIT_LOOKBACK_DAYS = 14;

/** Hide logistics / nadzór point markers below this scale. */
export const MARKER_MIN_DAY_PX = 8;

/** Show weekend shading only when day columns are wide enough. */
export const WEEKEND_MIN_DAY_PX = 12;

/** Minimum painted width for a 1-day work bar. */
export const BAR_MIN_PX = 3;

export type ZoomTickLevel = "day" | "week" | "month" | "quarter";

export type ZoomPresetId = "2w" | "1m" | "1q" | "1y" | "2y" | "fit";

export interface ZoomPreset {
  id: ZoomPresetId;
  label: string;
  /** Target days visible in the viewport (null = fit entire range). */
  visibleDays: number | null;
  /** Expand painted range to at least this many days (null = content only). */
  minRangeDays: number | null;
}

export const ZOOM_PRESETS: ZoomPreset[] = [
  { id: "2w", label: "2 tyg.", visibleDays: 14, minRangeDays: null },
  { id: "1m", label: "Miesiąc", visibleDays: 30, minRangeDays: null },
  { id: "1q", label: "Kwartał", visibleDays: 90, minRangeDays: null },
  { id: "1y", label: "Rok", visibleDays: 365, minRangeDays: 365 },
  { id: "2y", label: "2 lata", visibleDays: 730, minRangeDays: 730 },
  { id: "fit", label: "Dopasuj", visibleDays: null, minRangeDays: null },
];

export interface ScheduleRange {
  start: string;
  end: string;
  days: number;
}

export interface AxisTick {
  iso: string;
  label: string;
  offsetDays: number;
  /** Secondary weekday letter for day-level ticks. */
  weekday?: string;
}

function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function dayOffset(from: string, to: string) {
  return Math.round((parseDay(to) - parseDay(from)) / 86400000);
}

export function addDaysIso(iso: string, days: number) {
  const t = parseDay(iso) + days * 86400000;
  const dt = new Date(t);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Board scroll width from every relevant ISO date (blocks, category windows,
 * events, anchors). Pads edges so bars aren't flush against the clip.
 */
export function buildScheduleContentRange(
  dates: string[],
  pad = 3,
  fallbackToday?: string,
): ScheduleRange {
  const clean = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (clean.length === 0) {
    const t = fallbackToday ?? addDaysIso("2020-01-01", 0);
    return {
      start: addDaysIso(t, -pad),
      end: addDaysIso(t, 20),
      days: 21 + pad,
    };
  }
  let start = clean[0]!;
  let end = clean[0]!;
  for (const d of clean) {
    if (d < start) start = d;
    if (d > end) end = d;
  }
  start = addDaysIso(start, -pad);
  end = addDaysIso(end, pad);
  const days = Math.max(14, dayOffset(start, end) + 1);
  return { start, end, days };
}

/** Monday of the ISO week containing `iso` (PL week start). */
export function startOfWeekIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const jsDay = dt.getUTCDay(); // 0=Sun … 6=Sat
  const daysFromMonday = jsDay === 0 ? 6 : jsDay - 1;
  return addDaysIso(iso, -daysFromMonday);
}

/**
 * scrollLeft so `iso` sits at the left edge of the chart
 * (just after the sticky label column).
 */
export function scrollLeftForDayStart(opts: {
  rangeStart: string;
  dayPx: number;
  iso: string;
}): number {
  return Math.max(
    0,
    dayOffset(opts.rangeStart, opts.iso) * opts.dayPx,
  );
}

export function clampDayPx(n: number): number {
  if (!Number.isFinite(n)) return DAY_PX_DEFAULT;
  return Math.min(DAY_PX_MAX, Math.max(DAY_PX_MIN, n));
}

/** dayPx so that `visibleDays` fill `availPx` of chart width. */
export function dayPxForVisibleDays(availPx: number, visibleDays: number): number {
  const days = Math.max(1, visibleDays);
  const avail = Math.max(1, availPx);
  return clampDayPx(avail / days);
}

export function tickLevelForDayPx(dayPx: number): ZoomTickLevel {
  if (dayPx >= 24) return "day";
  if (dayPx >= 12) return "week";
  if (dayPx >= 6) return "month";
  return "quarter";
}

function localDate(iso: string) {
  return new Date(`${iso}T12:00:00`);
}

function formatDayMonth(iso: string) {
  return localDate(iso).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
  });
}

function formatMonthYear(iso: string) {
  return localDate(iso).toLocaleDateString("pl-PL", {
    month: "short",
    year: "2-digit",
  });
}

function formatQuarter(iso: string) {
  const d = localDate(iso);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function weekdayNarrow(iso: string) {
  return localDate(iso).toLocaleDateString("pl-PL", { weekday: "narrow" });
}

/**
 * Absolute-position ticks for the sticky axis header.
 * Day level still emits one tick per day (header only — O(days), not O(days×rows)).
 */
export function ticksForRange(
  start: string,
  days: number,
  dayPx: number,
): AxisTick[] {
  const level = tickLevelForDayPx(dayPx);
  const ticks: AxisTick[] = [];

  if (level === "day") {
    for (let i = 0; i < days; i++) {
      const iso = addDaysIso(start, i);
      const date = localDate(iso);
      const isMon = date.getDay() === 1 || i === 0;
      ticks.push({
        iso,
        label: isMon ? formatDayMonth(iso) : "",
        offsetDays: i,
        weekday: weekdayNarrow(iso),
      });
    }
    return ticks;
  }

  if (level === "week") {
    for (let i = 0; i < days; i++) {
      const iso = addDaysIso(start, i);
      const date = localDate(iso);
      if (date.getDay() === 1 || i === 0) {
        ticks.push({
          iso,
          label: formatDayMonth(iso),
          offsetDays: i,
        });
      }
    }
    return ticks;
  }

  if (level === "month") {
    for (let i = 0; i < days; i++) {
      const iso = addDaysIso(start, i);
      const date = localDate(iso);
      if (date.getDate() === 1 || i === 0) {
        ticks.push({
          iso,
          label: formatMonthYear(iso),
          offsetDays: i,
        });
      }
    }
    return ticks;
  }

  // quarter / year overview
  for (let i = 0; i < days; i++) {
    const iso = addDaysIso(start, i);
    const date = localDate(iso);
    const month = date.getMonth();
    if ((month % 3 === 0 && date.getDate() === 1) || i === 0) {
      ticks.push({
        iso,
        label: formatQuarter(iso),
        offsetDays: i,
      });
    }
  }
  return ticks;
}

/**
 * Widen a content-derived range so long presets (rok / 2 lata) actually span
 * that many calendar days, centered on `centerIso` (default: midpoint of range).
 */
export function expandRangeToMinDays(
  range: ScheduleRange,
  minDays: number | null | undefined,
  centerIso?: string,
): ScheduleRange {
  if (!minDays || minDays <= range.days) return range;

  const center =
    centerIso ??
    addDaysIso(range.start, Math.floor(range.days / 2));
  const halfBefore = Math.floor((minDays - 1) / 2);
  const halfAfter = minDays - 1 - halfBefore;
  let start = addDaysIso(center, -halfBefore);
  let end = addDaysIso(center, halfAfter);

  // Keep existing content inside the expanded window.
  if (range.start < start) {
    const shift = dayOffset(start, range.start);
    start = addDaysIso(start, shift);
    end = addDaysIso(end, shift);
  }
  if (range.end > end) {
    const shift = dayOffset(end, range.end);
    start = addDaysIso(start, shift);
    end = addDaysIso(end, shift);
  }

  return { start, end, days: dayOffset(start, end) + 1 };
}

/**
 * CSS repeating weekend band aligned to Mondays.
 * Returns null when weekends should be hidden (tight zoom).
 */
export function weekendBandStyle(
  rangeStart: string,
  dayPx: number,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } | null {
  if (dayPx < WEEKEND_MIN_DAY_PX) return null;

  const jsDay = localDate(rangeStart).getDay(); // 0=Sun … 6=Sat
  const daysFromMonday = jsDay === 0 ? 6 : jsDay - 1;
  const positionX = -daysFromMonday * dayPx;
  const week = 7 * dayPx;
  const work = 5 * dayPx;

  return {
    backgroundImage: `linear-gradient(to right, transparent 0, transparent ${work}px, rgba(255,255,255,0.03) ${work}px, rgba(255,255,255,0.03) ${week}px)`,
    backgroundSize: `${week}px 100%`,
    backgroundPosition: `${positionX}px 0`,
  };
}

/** ScrollLeft so `iso` stays under the same viewport X after dayPx changes. */
export function scrollLeftForAnchor(opts: {
  labelPx: number;
  rangeStart: string;
  dayPx: number;
  iso: string;
  viewportX: number;
}): number {
  const offset = dayOffset(opts.rangeStart, opts.iso) * opts.dayPx;
  return Math.max(0, opts.labelPx + offset - opts.viewportX);
}

/** ISO date under a chart X (pixels from chart left, not including label). */
export function isoAtChartX(
  rangeStart: string,
  rangeDays: number,
  dayPx: number,
  chartX: number,
): string {
  const idx = Math.max(
    0,
    Math.min(rangeDays - 1, Math.floor(chartX / Math.max(dayPx, 0.001))),
  );
  return addDaysIso(rangeStart, idx);
}

export function dayPxAfterWheel(
  current: number,
  deltaY: number,
  factor = 1.12,
): number {
  const next = deltaY > 0 ? current / factor : current * factor;
  return clampDayPx(next);
}
