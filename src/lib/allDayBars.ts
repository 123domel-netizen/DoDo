import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import type { Item } from "@/types";
import { allDayBarIndices, allDayCalendarDate } from "@/lib/allDay";

/** Całodniowe albo obejmujące więcej niż jeden dzień kalendarzowy. */
export function isBandItem(item: Pick<Item, "allDay" | "start" | "end">): boolean {
  if (item.allDay) return true;
  return (
    differenceInCalendarDays(startOfDay(new Date(item.end)), startOfDay(new Date(item.start))) >= 1
  );
}

export interface BandSpan {
  startIdx: number;
  endIdx: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

export interface BandBar extends BandSpan {
  item: Item;
  row: number;
}

export function bandSpanInRange(
  item: Pick<Item, "allDay" | "start" | "end">,
  rangeStart: Date,
  ndays: number,
): BandSpan | null {
  const rangeStartDay = startOfDay(rangeStart);
  const rangeEnd = addDays(rangeStartDay, ndays);

  if (item.allDay) {
    const idx = allDayBarIndices(item.start, item.end, rangeStartDay, ndays);
    if (!idx) return null;
    const eventStart = allDayCalendarDate(item.start);
    const eventEndExclusive = allDayCalendarDate(item.end);
    return {
      ...idx,
      continuesLeft: eventStart < rangeStartDay,
      continuesRight: eventEndExclusive > rangeEnd,
    };
  }

  const s = new Date(item.start);
  const e = new Date(item.end);
  if (e <= rangeStartDay || s >= rangeEnd) return null;
  const startIdx = Math.max(0, differenceInCalendarDays(startOfDay(s), rangeStartDay));
  const endIdx = Math.min(
    ndays - 1,
    differenceInCalendarDays(startOfDay(new Date(e.getTime() - 1)), rangeStartDay),
  );
  return {
    startIdx,
    endIdx,
    continuesLeft: s < rangeStartDay,
    continuesRight: e > rangeEnd,
  };
}

export function stackBandBars<T extends { startIdx: number; endIdx: number }>(
  bars: T[],
): (T & { row: number })[] {
  const sorted = [...bars].sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx);
  const rows: { endIdx: number }[] = [];
  return sorted.map((bar) => {
    let row = rows.findIndex((r) => bar.startIdx > r.endIdx);
    if (row === -1) {
      row = rows.length;
      rows.push({ endIdx: bar.endIdx });
    } else {
      rows[row].endIdx = bar.endIdx;
    }
    return { ...bar, row };
  });
}

/** Paski całodniowe / wielodniowe w zakresie `days` (greedy stacking wierszy). */
export function layoutBandItems(days: Date[], items: Item[]): BandBar[] {
  if (!days.length) return [];
  const rangeStart = startOfDay(days[0]);
  const ndays = days.length;
  const spans: Array<BandSpan & { item: Item }> = [];
  for (const item of items) {
    if (!isBandItem(item)) continue;
    const span = bandSpanInRange(item, rangeStart, ndays);
    if (span) spans.push({ item, ...span });
  }
  return stackBandBars(spans);
}
