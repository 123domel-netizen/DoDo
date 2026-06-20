import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalendarViewKind, Item } from "@/types";

export const MINUTES_PER_DAY = 24 * 60;

export function parseISO(iso: string): Date {
  return new Date(iso);
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Inclusive list of days shown for a given view + anchor. */
export function getViewDays(
  view: CalendarViewKind,
  anchor: Date,
  nineDayStartWeekday: number,
): Date[] {
  const a = startOfDay(anchor);
  switch (view) {
    case "day":
      return [a];
    case "week": {
      const start = startOfWeek(a, { weekStartsOn: 1 }); // Monday
      return range(7).map((i) => addDays(start, i));
    }
    case "eleven": {
      // 11 dni od skonfigurowanego dnia tygodnia (domyślnie piątek → kolejny poniedziałek).
      const back = (a.getDay() - nineDayStartWeekday + 7) % 7;
      const start = addDays(a, -back);
      return range(11).map((i) => addDays(start, i));
    }
    case "month": {
      const first = startOfWeek(startOfMonth(a), { weekStartsOn: 1 });
      const last = endOfWeek(endOfMonth(a), { weekStartsOn: 1 });
      const count = differenceInCalendarDays(last, first) + 1;
      return range(count).map((i) => addDays(first, i));
    }
  }
}

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Where an item falls relative to the visible hour window of a given day. */
export type DayPlacement = "before" | "after" | "timed" | "none";

export function placementForDay(
  item: Item,
  day: Date,
  dayStartHour: number,
  dayEndHour: number,
): DayPlacement {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const s = parseISO(item.start);
  const e = parseISO(item.end);
  // Does the item overlap this calendar day at all?
  if (e <= dayStart || s >= dayEnd) return "none";

  const visStart = new Date(dayStart);
  visStart.setHours(dayStartHour, 0, 0, 0);
  const visEnd = new Date(dayStart);
  visEnd.setHours(0, 0, 0, 0);
  visEnd.setMinutes(dayEndHour * 60);

  // Clamp item to this day.
  const cs = s < dayStart ? dayStart : s;
  const ce = e > dayEnd ? dayEnd : e;

  // Overlaps visible window -> timed.
  if (ce > visStart && cs < visEnd) return "timed";
  // Entirely before visible window.
  if (ce <= visStart) return "before";
  return "after";
}

export interface TimedGeometry {
  topPx: number;
  heightPx: number;
}

/** Pixel geometry for a timed item clamped to the visible window of `day`. */
export function timedGeometry(
  item: Item,
  day: Date,
  dayStartHour: number,
  dayEndHour: number,
  hourHeight: number,
): TimedGeometry {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const s = parseISO(item.start);
  const e = parseISO(item.end);
  const cs = s < dayStart ? dayStart : s;
  const ce = e > dayEnd ? dayEnd : e;

  const startMin = Math.max(minutesOfDay(cs), dayStartHour * 60);
  const endMinRaw = ce.getTime() === dayEnd.getTime() ? dayEndHour * 60 : minutesOfDay(ce);
  const endMin = Math.min(Math.max(endMinRaw, startMin + 1), dayEndHour * 60);

  const pxPerMin = hourHeight / 60;
  const topPx = (startMin - dayStartHour * 60) * pxPerMin;
  const heightPx = Math.max((endMin - startMin) * pxPerMin, 16);
  return { topPx, heightPx };
}

/** Convert a vertical pixel offset within the timed grid to minutes-of-day. */
export function yToMinutes(
  y: number,
  dayStartHour: number,
  hourHeight: number,
  snapMinutes = 15,
): number {
  const pxPerMin = hourHeight / 60;
  let minutes = dayStartHour * 60 + y / pxPerMin;
  minutes = Math.round(minutes / snapMinutes) * snapMinutes;
  return Math.max(0, Math.min(minutes, MINUTES_PER_DAY));
}

export function setMinutesOfDay(day: Date, minutes: number): Date {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return d;
}

/** Overlap-aware column layout for a set of timed items on one day. */
export interface LaidOutItem {
  item: Item;
  geom: TimedGeometry;
  col: number;
  cols: number;
}

export function layoutTimed(
  items: { item: Item; geom: TimedGeometry }[],
): LaidOutItem[] {
  const sorted = [...items].sort(
    (a, b) =>
      a.geom.topPx - b.geom.topPx ||
      b.geom.heightPx - a.geom.heightPx,
  );
  const result: LaidOutItem[] = [];
  let cluster: { item: Item; geom: TimedGeometry }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const columns: number[] = []; // bottom px per column
    const placed: { entry: (typeof cluster)[number]; col: number }[] = [];
    for (const entry of cluster) {
      let col = columns.findIndex((bottom) => entry.geom.topPx >= bottom - 0.5);
      if (col === -1) {
        col = columns.length;
        columns.push(0);
      }
      columns[col] = entry.geom.topPx + entry.geom.heightPx;
      placed.push({ entry, col });
    }
    const cols = columns.length;
    for (const { entry, col } of placed) {
      result.push({ item: entry.item, geom: entry.geom, col, cols });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const entry of sorted) {
    if (entry.geom.topPx >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.geom.topPx + entry.geom.heightPx);
  }
  flush();
  return result;
}
