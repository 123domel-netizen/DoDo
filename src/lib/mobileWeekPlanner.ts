import type { Item } from "@/types";
import { itemCoversCalendarDay } from "@/lib/allDay";
import { isBandItem } from "@/lib/allDayBars";

export interface WeekDaySection {
  day: Date;
  events: Item[];
}

/** Wydarzenia z godziną w danym dniu (bez pasków wielodniowych i zadań). */
export function timedEventsForDay(day: Date, items: Item[]): Item[] {
  return items
    .filter(
      (it) =>
        !isBandItem(it) && it.type !== "task" && itemCoversCalendarDay(it, day),
    )
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/** Liczba wydarzeń kalendarzowych w dniu (do wskaźnika obłożenia). */
export function dayActivityCount(day: Date, items: Item[]): number {
  return items.filter(
    (it) => it.type !== "task" && itemCoversCalendarDay(it, day),
  ).length;
}

/** Dni tygodnia z wydarzeniami godzinowymi — tylko niepuste sekcje. */
export function weekTimedSections(weekDays: Date[], items: Item[]): WeekDaySection[] {
  return weekDays
    .map((day) => ({ day, events: timedEventsForDay(day, items) }))
    .filter((s) => s.events.length > 0);
}

export function weekHasCalendarEvents(weekDays: Date[], items: Item[]): boolean {
  return weekDays.some((day) => dayActivityCount(day, items) > 0);
}

/** @deprecated Używane tylko w testach. */
export function busyBarHeight(count: number, max = 10): number {
  if (count <= 0) return 0;
  return Math.min(14, 3 + Math.round((Math.min(count, max) / max) * 11));
}
