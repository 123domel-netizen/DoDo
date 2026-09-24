/**
 * Walidacja i sanitizacja dat — warstwa ingestu.
 *
 * „Invalid time value” leci z date-fns / Date#toISOString, gdy string z IDB
 * albo z chmury nie daje poprawnej daty. Ta warstwa naprawia dane zanim
 * trafią do store / formatowania — zamiast try/catch w każdym komponencie.
 */

import type { GoogleRecurrenceException, Item, ItemType, Reminder } from "@/types";

/** Jak w factory — zadania bez terminu; nie crashuje formatowania. */
export const DATE_PLACEHOLDER_ISO = "1970-01-01T00:00:00.000Z";

export function coerceItemType(item: Pick<Item, "type" | "showInTodo" | "showInCalendar">): ItemType {
  if (item.type === "event" || item.type === "task") return item.type;
  // Legacy IDB: brak `type` — zgaduj po flagach widoczności.
  if (item.showInTodo && !item.showInCalendar) return "task";
  return "event";
}

export function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Czy wartość da się bezpiecznie sformatować jako Instant. */
export function isValidIso(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  return isValidDate(new Date(value));
}

export function parseValidDate(value: unknown): Date | null {
  if (value instanceof Date) return isValidDate(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return isValidDate(d) ? d : null;
}

/** Zwraca ISO albo null — puste / śmieci nie przechodzą jako „prawie data”. */
export function coerceIsoOrNull(value: unknown): string | null {
  const d = parseValidDate(value);
  return d ? d.toISOString() : null;
}

export function coerceIsoOrFallback(value: unknown, fallback: string): string {
  return coerceIsoOrNull(value) ?? fallback;
}

function sanitizeReminders(reminders: Reminder[] | undefined): Reminder[] {
  if (!reminders?.length) return reminders ?? [];
  return reminders.map((r) => {
    if (r.remindAt == null || r.remindAt === "") return { ...r, remindAt: null };
    if (isValidIso(r.remindAt)) return r;
    return { ...r, remindAt: null };
  });
}

function sanitizeExceptions(
  exceptions: GoogleRecurrenceException[] | undefined,
): GoogleRecurrenceException[] | undefined {
  if (!exceptions?.length) return exceptions;
  const out: GoogleRecurrenceException[] = [];
  for (const ex of exceptions) {
    if (!isValidIso(ex.originalStart)) continue;
    const start =
      ex.start == null || ex.start === "" ? undefined : coerceIsoOrNull(ex.start) ?? undefined;
    const end =
      ex.end == null || ex.end === "" ? undefined : coerceIsoOrNull(ex.end) ?? undefined;
    if (ex.status === "modified" && ((ex.start && !start) || (ex.end && !end))) continue;
    const cleaned: GoogleRecurrenceException = {
      originalStart: new Date(ex.originalStart).toISOString(),
      status: ex.status,
    };
    if (ex.title !== undefined) cleaned.title = ex.title;
    if (start) cleaned.start = start;
    if (end) cleaned.end = end;
    out.push(cleaned);
  }
  return out;
}

export type ItemDateSanitizeResult = {
  item: Item;
  /** Czy start/end były zepsute na tyle, że zdjęto termin z kalendarza. */
  demotedDueDate: boolean;
  repaired: boolean;
};

/**
 * Naprawia daty i wymagane pola wpisu przed zapisem do store / upsertem.
 * - Opcjonalne pola (deadline, pinned, deletedAt, …) ze śmieciem → null / drop.
 * - start/end niereperowalne przy hasDueDate → hasDueDate=false + placeholder
 *   (wpis zostaje, nie wywala renderu kalendarza).
 * - brak `type` (legacy IDB) → event|task — inaczej Postgres NOT NULL blokuje
 *   całą paczkę syncu i „Wyślij” stoi w miejscu.
 */
export function sanitizeItemDates(item: Item, nowIso = new Date().toISOString()): ItemDateSanitizeResult {
  let repaired = false;
  let demotedDueDate = false;
  let next: Item = { ...item };

  const type = coerceItemType(item);
  if (type !== item.type) {
    next = { ...next, type };
    repaired = true;
  }

  if (typeof item.title !== "string") {
    next = { ...next, title: item.title == null ? "" : String(item.title) };
    repaired = true;
  }
  if (typeof item.description !== "string") {
    next = {
      ...next,
      description: item.description == null ? "" : String(item.description),
    };
    repaired = true;
  }

  const start = coerceIsoOrNull(item.start);
  const end = coerceIsoOrNull(item.end);

  if (item.hasDueDate) {
    if (!start && !end) {
      next = {
        ...next,
        start: DATE_PLACEHOLDER_ISO,
        end: DATE_PLACEHOLDER_ISO,
        hasDueDate: false,
        showInCalendar: false,
      };
      demotedDueDate = true;
      repaired = true;
    } else if (!start && end) {
      next = { ...next, start: end, end };
      repaired = true;
    } else if (start && !end) {
      next = { ...next, start, end: start };
      repaired = true;
    } else if (start && end) {
      // Koniec przed startem — rozszerz do startu (nie odwracaj milcząco o dni).
      if (new Date(end).getTime() < new Date(start).getTime()) {
        next = { ...next, start, end: start };
        repaired = true;
      } else if (start !== item.start || end !== item.end) {
        next = { ...next, start, end };
        repaired = true;
      }
    }
  } else {
    next = {
      ...next,
      start: start ?? DATE_PLACEHOLDER_ISO,
      end: end ?? start ?? DATE_PLACEHOLDER_ISO,
    };
    if (next.start !== item.start || next.end !== item.end) repaired = true;
  }

  const deadlineAt = item.deadlineAt == null || item.deadlineAt === ""
    ? null
    : coerceIsoOrNull(item.deadlineAt);
  if (deadlineAt !== item.deadlineAt) {
    next = { ...next, deadlineAt };
    repaired = true;
  }

  const pinnedAt = item.pinnedAt == null || item.pinnedAt === ""
    ? null
    : coerceIsoOrNull(item.pinnedAt);
  if (pinnedAt !== (item.pinnedAt ?? null)) {
    next = { ...next, pinnedAt };
    repaired = true;
  }

  const deletedAt = item.deletedAt == null || item.deletedAt === ""
    ? null
    : coerceIsoOrNull(item.deletedAt);
  if (deletedAt !== (item.deletedAt ?? null)) {
    next = { ...next, deletedAt };
    repaired = true;
  }

  const createdAt = coerceIsoOrFallback(item.createdAt, nowIso);
  const updatedAt = coerceIsoOrFallback(item.updatedAt, nowIso);
  if (createdAt !== item.createdAt || updatedAt !== item.updatedAt) {
    next = { ...next, createdAt, updatedAt };
    repaired = true;
  }

  const reminders = sanitizeReminders(item.reminders);
  if (JSON.stringify(reminders) !== JSON.stringify(item.reminders ?? [])) {
    next = { ...next, reminders };
    repaired = true;
  }

  if (item.recurrence?.until != null && item.recurrence.until !== "") {
    const until = coerceIsoOrNull(item.recurrence.until);
    if (until !== item.recurrence.until) {
      next = {
        ...next,
        recurrence: { ...item.recurrence, until },
      };
      repaired = true;
    }
  }

  const exceptions = sanitizeExceptions(item.googleRecurrenceExceptions);
  if (JSON.stringify(exceptions) !== JSON.stringify(item.googleRecurrenceExceptions)) {
    next = { ...next, googleRecurrenceExceptions: exceptions };
    repaired = true;
  }

  return { item: next, demotedDueDate, repaired };
}

export function sanitizeItemsRecord(
  items: Record<string, Item>,
): { items: Record<string, Item>; repairedCount: number; demotedCount: number } {
  let repairedCount = 0;
  let demotedCount = 0;
  const out: Record<string, Item> = {};
  for (const [id, it] of Object.entries(items)) {
    const res = sanitizeItemDates(it);
    out[id] = res.item;
    if (res.repaired) repairedCount += 1;
    if (res.demotedDueDate) demotedCount += 1;
  }
  return { items: out, repairedCount, demotedCount };
}

/** Bezpieczny ISO z Date — zamiast rzucać RangeError. */
export function safeToIso(value: Date | string | null | undefined): string | null {
  const d = parseValidDate(value);
  return d ? d.toISOString() : null;
}
