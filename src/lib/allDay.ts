import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import type { Item } from "@/types";

/** Kanoniczny zapis dnia kalendarzowego: południe UTC (odporne na strefy ±12h). */
export const NOON_ANCHOR_RE = /^\d{4}-\d{2}-\d{2}T12:00:00\.000Z$/;

export function isNoonAnchorIso(iso: string): boolean {
  return NOON_ANCHOR_RE.test(iso);
}

/** Data kalendarzowa do wyświetlania / logiki wydarzenia całodniowego. */
export function allDayCalendarDate(iso: string): Date {
  if (isNoonAnchorIso(iso)) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return startOfDay(new Date(iso));
}

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO z kotwicą w południe UTC dla danego dnia kalendarzowego (lokalnie). */
export function noonAnchorFromCalendarDate(d: Date): string {
  return `${ymdFromDate(d)}T12:00:00.000Z`;
}

/** Przepisuje legacy ISO na kotwicę południa UTC wg dnia kalendarzowego użytkownika. */
export function reanchorAllDayIso(iso: string): string {
  return noonAnchorFromCalendarDate(allDayCalendarDate(iso));
}

/** Liczba dni kalendarzowych (end wyłączne, jak w Google). */
export function allDaySpanDays(start: string, end: string): number {
  return differenceInCalendarDays(allDayCalendarDate(end), allDayCalendarDate(start));
}

/** Pojedyncze wydarzenie całodniowe: end = następny dzień kalendarzowy (wyłączny). */
export function normalizeAllDayRange(start: string, end?: string): { start: string; end: string } {
  const startDate = allDayCalendarDate(start);
  const endDate = end ? allDayCalendarDate(end) : addDays(startDate, 1);
  const span = Math.max(1, differenceInCalendarDays(endDate, startDate));
  return {
    start: noonAnchorFromCalendarDate(startDate),
    end: noonAnchorFromCalendarDate(addDays(startDate, span)),
  };
}

export function withNormalizedAllDay(item: Item): Item {
  if (!item.allDay || !item.hasDueDate) return item;
  const { start, end } = normalizeAllDayRange(item.start, item.end);
  if (start === item.start && end === item.end) return item;
  return { ...item, start, end };
}
