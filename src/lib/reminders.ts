import type { Item, Reminder } from "@/types";
import { isSharedItem } from "@/lib/share";
import { fmt } from "@/lib/format";

/** Przypomnienia widoczne dla bieżącego użytkownika (właściciel vs uczestnik SHARE). */
export function effectiveReminders(item: Item): Reminder[] {
  if (isSharedItem(item)) return item.personalReminders ?? [];
  return item.reminders;
}

export function isAbsoluteReminder(r: Reminder): boolean {
  return Boolean(r.remindAt);
}

/** Czas wywołania przypomnienia (ms) lub null, gdy nie można obliczyć. */
export function reminderFireTimeMs(item: Item, r: Reminder): number | null {
  if (r.remindAt) {
    const t = new Date(r.remindAt).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (!item.hasDueDate) return null;
  return reminderFireAt(item, r.offsetMinutes).getTime();
}

const RELATIVE_LABELS: Record<number, string> = {
  0: "W momencie",
  5: "5 min przed",
  10: "10 min przed",
  15: "15 min przed",
  30: "30 min przed",
  60: "1 godz. przed",
  1440: "1 dzień przed",
};

export function reminderDisplayLabel(r: Reminder): string {
  if (r.remindAt) return fmt(new Date(r.remindAt), "d MMM, HH:mm");
  const preset = RELATIVE_LABELS[r.offsetMinutes];
  if (preset) return preset;
  if (r.offsetMinutes % 1440 === 0) return `${r.offsetMinutes / 1440} dni przed`;
  if (r.offsetMinutes % 60 === 0) return `${r.offsetMinutes / 60} godz. przed`;
  return `${r.offsetMinutes} min przed`;
}

/** Pinezka na kalendarzu: tylko dzwoneczek w chwili przypomnienia. */
export interface ReminderMarker {
  key: string;
  item: Item;
  at: Date;
  offsetMinutes: number;
}

export function reminderFireAt(item: Item, offsetMinutes: number): Date {
  return new Date(new Date(item.start).getTime() - offsetMinutes * 60_000);
}

/** Markery dla elementów bez „Pokaż w kalendarzu”, ale z przypomnieniami. */
export function collectReminderMarkers(items: Item[]): ReminderMarker[] {
  const markers: ReminderMarker[] = [];
  for (const item of items) {
    if (item.showInCalendar || item.done || item.allDay) continue;
    for (const r of effectiveReminders(item)) {
      if (isAbsoluteReminder(r)) {
        const at = new Date(r.remindAt!);
        if (Number.isNaN(at.getTime())) continue;
        markers.push({
          key: `${item.id}:${r.id}`,
          item,
          at,
          offsetMinutes: r.offsetMinutes,
        });
        continue;
      }
      if (!item.hasDueDate) continue;
      markers.push({
        key: `${item.id}:${r.id}`,
        item,
        at: reminderFireAt(item, r.offsetMinutes),
        offsetMinutes: r.offsetMinutes,
      });
    }
  }
  return markers;
}

export function markerAsTimedSlice(marker: ReminderMarker): Pick<Item, "start" | "end" | "allDay"> {
  const end = new Date(marker.at.getTime() + 60_000);
  return {
    start: marker.at.toISOString(),
    end: end.toISOString(),
    allDay: false,
  };
}
