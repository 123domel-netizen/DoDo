import type { Item } from "@/types";

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
    if (!item.hasDueDate || item.showInCalendar || item.done || item.allDay) continue;
    for (const r of item.reminders) {
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
