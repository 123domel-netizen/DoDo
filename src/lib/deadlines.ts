import { isSameDay } from "date-fns";
import type { Item } from "@/types";
import { itemCoversCalendarDay } from "@/lib/allDay";
import { isItemDeleted } from "@/lib/items";

export interface DeadlineMarker {
  key: string;
  item: Item;
  at: Date;
}

export const DEADLINE_PRESET_DAYS = [7, 14, 21, 30] as const;

/** Data bazowa presetów: start itemu gdy ma termin, inaczej dziś. */
export function deadlineBaseDateForItem(item: Pick<Item, "hasDueDate" | "start">): Date {
  if (item.hasDueDate) {
    const d = new Date(item.start);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function deadlineAtNoonFromBaseDate(baseDate: Date, daysAhead: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export function deadlineAtNoonFromItem(
  item: Pick<Item, "hasDueDate" | "start">,
  daysAhead: number,
): string {
  return deadlineAtNoonFromBaseDate(deadlineBaseDateForItem(item), daysAhead);
}

/** @deprecated Użyj deadlineAtNoonFromItem — liczy od dzisiaj. */
export function deadlineAtNoonFromToday(daysAhead: number): string {
  return deadlineAtNoonFromBaseDate(new Date(), daysAhead);
}

export function deadlineTooltipTitle(item: Item): string {
  const label = item.title || (item.type === "task" ? "Zadanie" : "Wydarzenie");
  return `Deadline: ${label}`;
}

/** Czy na dany dzień element jest widoczny w kalendarzu z inline ikoną deadline. */
export function itemShowsInlineDeadlineOnDay(item: Item, day: Date): boolean {
  if (!item.deadlineAt) return false;
  if (!isSameDay(new Date(item.deadlineAt), day)) return false;
  if (!item.showInCalendar || !item.hasDueDate) return false;
  return itemCoversCalendarDay(item, day);
}

export function collectDeadlineMarkers(items: Item[]): DeadlineMarker[] {
  const markers: DeadlineMarker[] = [];
  for (const item of items) {
    if (isItemDeleted(item) || !item.deadlineAt) continue;
    const at = new Date(item.deadlineAt);
    if (itemShowsInlineDeadlineOnDay(item, at)) continue;
    markers.push({ key: `${item.id}:deadline`, item, at });
  }
  return markers;
}

export function deadlineMarkerSlice(deadlineAt: string): Pick<Item, "start" | "end" | "allDay"> {
  const start = new Date(deadlineAt);
  const end = new Date(start.getTime() + 60_000);
  return { start: start.toISOString(), end: end.toISOString(), allDay: false };
}

export function deadlineIconDimmed(item: Item): boolean {
  return item.type === "task" && item.done;
}
