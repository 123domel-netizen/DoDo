import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import type { Item } from "@/types";

/** Liczba dni kalendarzowych (end wyłączne, jak w Google). */
export function allDaySpanDays(start: string, end: string): number {
  return differenceInCalendarDays(startOfDay(new Date(end)), startOfDay(new Date(start)));
}

/** Pojedyncze wydarzenie całodniowe: end = północ następnego dnia. */
export function normalizeAllDayRange(start: string, _end?: string): { start: string; end: string } {
  const s = startOfDay(new Date(start));
  return { start: s.toISOString(), end: addDays(s, 1).toISOString() };
}

export function withNormalizedAllDay(item: Item): Item {
  if (!item.allDay || !item.hasDueDate) return item;
  if (allDaySpanDays(item.start, item.end) === 1) return item;
  const { start, end } = normalizeAllDayRange(item.start, item.end);
  if (start === item.start && end === item.end) return item;
  return { ...item, start, end };
}
