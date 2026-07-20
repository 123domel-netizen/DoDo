import { addMinutes } from "date-fns";
import type { Group, Item, ItemType } from "@/types";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Wyrazista, ale nie jaskrawa paleta — czytelna w jasnym i ciemnym motywie. */
export const GROUP_COLORS = [
  "#4A8FC4", // Błękit
  "#4F9E7A", // Szałwia
  "#C08F52", // Piaskowy
  "#8F6AA8", // Figa
  "#4599AD", // Stal
  "#A67D4A", // Brąz
  "#7A6CB8", // Lawenda
  "#6A7280", // Grafit
];

export const LEGACY_GROUP_COLOR_MAP: Record<string, string> = {
  // Notion → stonowane (v3)
  "#e03e3e": "#7A6CB8",
  "#d9730d": "#C08F52",
  "#dfab01": "#A67D4A",
  "#0f7b6c": "#4F9E7A",
  "#0b6e99": "#4A8FC4",
  "#6940a5": "#8F6AA8",
  "#ad1a72": "#7A6CB8",
  "#64473a": "#A67D4A",
  "#787774": "#6A7280",
  // Stonowane → lekko żywsze (v15)
  "#5e7fa8": "#4A8FC4",
  "#6b9080": "#4F9E7A",
  "#9a8574": "#C08F52",
  "#7d6b8c": "#8F6AA8",
  "#6a8f9b": "#4599AD",
  "#8a7b68": "#A67D4A",
  "#857a9e": "#7A6CB8",
  "#737881": "#6A7280",
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
    deadlineAt: partial.deadlineAt ?? null,
    tagIds: partial.tagIds ?? [],
    recurrence: partial.recurrence ?? null,
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
