import { isSameDay } from "date-fns";
import type { Item } from "@/types";
import { itemCoversCalendarDay } from "@/lib/allDay";
import { isBandItem } from "@/lib/allDayBars";
import type { ReminderMarker } from "@/lib/reminders";
import type { DeadlineMarker } from "@/lib/deadlines";

export type MobileDayEntry =
  | { kind: "item"; at: Date; item: Item }
  | { kind: "reminder"; at: Date; marker: ReminderMarker }
  | { kind: "deadline"; at: Date; marker: DeadlineMarker };

export function buildMobileDayEntries(
  day: Date,
  items: Item[],
  reminderMarkers: ReminderMarker[],
  deadlineMarkers: DeadlineMarker[],
  opts?: { excludeBandItems?: boolean },
): MobileDayEntry[] {
  const excludeBand = opts?.excludeBandItems ?? true;
  const dayItems = items
    .filter((it) => itemCoversCalendarDay(it, day))
    .filter((it) => !excludeBand || !isBandItem(it))
    .map((it) => ({ kind: "item" as const, at: new Date(it.start), item: it }));
  const dayReminders = reminderMarkers
    .filter((m) => isSameDay(m.at, day))
    .map((m) => ({ kind: "reminder" as const, at: m.at, marker: m }));
  const dayDeadlines = deadlineMarkers
    .filter((m) => isSameDay(m.at, day))
    .map((m) => ({ kind: "deadline" as const, at: m.at, marker: m }));
  return [...dayItems, ...dayReminders, ...dayDeadlines].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );
}

/** Pierwsze nadchodzące wydarzenie (bez all-day/band) od `now`. */
export function findNextUpcomingItem(
  day: Date,
  items: Item[],
  now = new Date(),
): Item | null {
  if (!isSameDay(day, now)) return null;
  const timed = items
    .filter((it) => !isBandItem(it) && it.type !== "task")
    .filter((it) => itemCoversCalendarDay(it, day))
    .filter((it) => new Date(it.end).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return timed[0] ?? null;
}
