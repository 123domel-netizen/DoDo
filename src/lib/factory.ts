import { addMinutes } from "date-fns";
import type { Group, Item, ItemType } from "@/types";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Stonowana paleta pod ciemny motyw (bez jaskrawych kolorów Notion). */
export const GROUP_COLORS = [
  "#5E7FA8",
  "#6B9080",
  "#9A8574",
  "#7D6B8C",
  "#6A8F9B",
  "#8A7B68",
  "#857A9E",
  "#737881",
];

export const LEGACY_GROUP_COLOR_MAP: Record<string, string> = {
  "#e03e3e": "#857A9E",
  "#d9730d": "#9A8574",
  "#dfab01": "#8A7B68",
  "#0f7b6c": "#6B9080",
  "#0b6e99": "#5E7FA8",
  "#6940a5": "#7D6B8C",
  "#ad1a72": "#857A9E",
  "#64473a": "#8A7B68",
  "#787774": "#737881",
};

export function migrateGroupColor(color: string): string {
  return LEGACY_GROUP_COLOR_MAP[color.toLowerCase()] ?? color;
}

const PLACEHOLDER_ISO = "1970-01-01T00:00:00.000Z";

/** Domyślny termin zadania — punkt w czasie (0 min), bez bloku w kalendarzu. */
export function defaultTaskDueRange(): { start: string; end: string } {
  const t = new Date();
  t.setHours(12, 0, 0, 0);
  const iso = t.toISOString();
  return { start: iso, end: iso };
}

/** Blok 1 h w kalendarzu kończący się w podanym momencie (deadline). */
export function calendarBlockFromDeadline(
  deadlineIso: string,
  durationMinutes = 60,
): { start: string; end: string } {
  const end = new Date(deadlineIso);
  const start = new Date(end.getTime() - durationMinutes * 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function itemDurationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

export function createItem(partial: Partial<Item>): Item {
  const now = new Date().toISOString();
  const type: ItemType = partial.type ?? "event";
  const hasDueDate = partial.hasDueDate ?? type === "event";

  let start: string;
  let end: string;
  if (hasDueDate) {
    start = partial.start ?? now;
    if (partial.end !== undefined) {
      end = partial.end;
    } else if (type === "task") {
      end = start;
    } else {
      end = addMinutes(new Date(start), 60).toISOString();
    }
  } else {
    start = partial.start ?? PLACEHOLDER_ISO;
    end = partial.end ?? PLACEHOLDER_ISO;
  }

  return {
    id: partial.id ?? uid(),
    type,
    title: partial.title ?? "",
    description: partial.description ?? "",
    start,
    end,
    allDay: partial.allDay ?? false,
    groupId: partial.groupId ?? null,
    showInCalendar: partial.showInCalendar ?? type === "event",
    showInTodo: partial.showInTodo ?? type === "task",
    done: partial.done ?? false,
    preArchiveGroupId: partial.preArchiveGroupId ?? null,
    hasDueDate,
    checklist: partial.checklist ?? [],
    participants: partial.participants ?? [],
    attachments: partial.attachments ?? [],
    reminders: partial.reminders ?? [],
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

export function defaultGroups(): Group[] {
  return [
    { id: uid(), name: "Rodzinne", color: GROUP_COLORS[1], sortOrder: 0 },
    { id: uid(), name: "Firma A", color: GROUP_COLORS[0], sortOrder: 1 },
    { id: uid(), name: "Zakupy", color: GROUP_COLORS[2], sortOrder: 2 },
  ];
}
