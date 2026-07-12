import type { Item } from "@/types";
import { effectiveReminders, isAbsoluteReminder } from "@/lib/reminders";
import { expandItemOccurrences, hasRecurrence } from "@/lib/recurrence";
import { isItemDeleted } from "@/lib/items";
import { isSharedItem } from "@/lib/share";
import { fmt, fmtTime } from "@/lib/format";

/**
 * Czysta logika lokalnego schedulera powiadomień (testowalna bez DOM).
 *
 * Dedupe odbywa się po `key` (item + reminder + dokładny czas odpalenia), więc
 * przypomnienia wydarzeń CYKLICZNYCH odpalają się dla każdego wystąpienia,
 * a nie tylko raz (poprzednio `firedAt` blokowało kolejne wystąpienia).
 */

/** Jak długo po terminie przypomnienie jest jeszcze doręczane (np. po wybudzeniu laptopa). */
export const LATE_WINDOW_MS = 60 * 60_000;

/** Maksymalny offset przypomnienia brany pod uwagę przy rozwijaniu cyklu (dni). */
const MAX_OFFSET_CAP_MINUTES = 60 * 24 * 60;

export interface DueNotification {
  /** Unikalny klucz dedupe: `${itemId}:${reminderId}:${fireAtIso}`. */
  key: string;
  /** Bazowy item (bez sufiksu wystąpienia). */
  itemId: string;
  title: string;
  body: string;
  fireAt: number;
  kind: "reminder" | "deadline";
  /** Id przypomnienia — tylko dla nie-cyklicznych, do patcha `firedAt`. */
  markFiredReminderId?: string;
  /** Czy item jest współdzielony (patch idzie w personalReminders + RPC). */
  shared: boolean;
}

function maxRelativeOffsetMinutes(item: Item): number {
  let max = 0;
  for (const r of effectiveReminders(item)) {
    if (!isAbsoluteReminder(r)) max = Math.max(max, r.offsetMinutes);
  }
  return Math.min(max, MAX_OFFSET_CAP_MINUTES);
}

function occurrenceStartsAround(item: Item, now: number): Date[] {
  const maxOffsetMs = maxRelativeOffsetMinutes(item) * 60_000;
  const from = new Date(now - LATE_WINDOW_MS);
  const to = new Date(now + maxOffsetMs + LATE_WINDOW_MS);
  return expandItemOccurrences(item, from, to, "any").map((occ) => new Date(occ.start));
}

function isDue(fireAt: number, now: number): boolean {
  return fireAt <= now && now - fireAt < LATE_WINDOW_MS;
}

function reminderTitle(item: Item): string {
  return item.title || (item.type === "task" ? "Zadanie" : "Wydarzenie");
}

/**
 * Zbiera powiadomienia należne w tej chwili. `alreadyFired` to lokalny log
 * (localStorage) — trwały dedupe per dokładny czas odpalenia.
 */
export function collectDueNotifications(
  items: Item[],
  now: number,
  alreadyFired: (key: string) => boolean,
): DueNotification[] {
  const out: DueNotification[] = [];

  for (const item of items) {
    if (isItemDeleted(item) || item.done) continue;

    const shared = isSharedItem(item);
    const recurring = hasRecurrence(item);
    const reminders = effectiveReminders(item);

    if (reminders.length) {
      const occStarts = recurring
        ? occurrenceStartsAround(item, now)
        : item.hasDueDate
          ? [new Date(item.start)]
          : [];

      for (const r of reminders) {
        if (isAbsoluteReminder(r)) {
          const at = new Date(r.remindAt!);
          const fireAt = at.getTime();
          if (Number.isNaN(fireAt) || !isDue(fireAt, now)) continue;
          if (r.firedAt) continue; // legacy dedupe (sync między urządzeniami)
          const key = `${item.id}:${r.id}:${at.toISOString()}`;
          if (alreadyFired(key)) continue;
          out.push({
            key,
            itemId: item.id,
            title: reminderTitle(item),
            body: `Przypomnienie o ${fmt(at, "d MMM, HH:mm")}`,
            fireAt,
            kind: "reminder",
            markFiredReminderId: r.id,
            shared,
          });
          continue;
        }

        for (const occStart of occStarts) {
          const fireAt = occStart.getTime() - r.offsetMinutes * 60_000;
          if (!isDue(fireAt, now)) continue;
          // firedAt blokuje tylko nie-cykliczne — dla cyklu każde wystąpienie
          // ma własny klucz i musi się odpalić.
          if (!recurring && r.firedAt) continue;
          const key = `${item.id}:${r.id}:${new Date(fireAt).toISOString()}`;
          if (alreadyFired(key)) continue;
          out.push({
            key,
            itemId: item.id,
            title: reminderTitle(item),
            body: `${item.type === "task" ? "Zadanie" : "Wydarzenie"} o ${fmtTime(occStart)}`,
            fireAt,
            kind: "reminder",
            markFiredReminderId: recurring ? undefined : r.id,
            shared,
          });
        }
      }
    }

    // Deadline: powiadomienie „1 dzień przed" oraz w chwili deadline'u.
    // Tylko dla właściciela — deadline to osobisty termin autora wpisu.
    if (item.deadlineAt && !shared) {
      const at = new Date(item.deadlineAt);
      if (!Number.isNaN(at.getTime())) {
        const slots: Array<{ fireAt: number; suffix: string; body: string }> = [
          {
            fireAt: at.getTime() - 24 * 60 * 60_000,
            suffix: "24h",
            body: `Deadline jutro: ${fmt(at, "d MMM, HH:mm")}`,
          },
          {
            fireAt: at.getTime(),
            suffix: "0",
            body: `Termin: ${fmt(at, "d MMM, HH:mm")}`,
          },
        ];
        for (const slot of slots) {
          if (!isDue(slot.fireAt, now)) continue;
          const key = `${item.id}:deadline-${slot.suffix}:${item.deadlineAt}`;
          if (alreadyFired(key)) continue;
          out.push({
            key,
            itemId: item.id,
            title: `Deadline: ${reminderTitle(item)}`,
            body: slot.body,
            fireAt: slot.fireAt,
            kind: "deadline",
            shared,
          });
        }
      }
    }
  }

  return out;
}

// --- Trwały log odpalonych powiadomień (localStorage) ------------------------

const FIRED_LOG_KEY = "dodo-local-fired-v1";
const FIRED_LOG_TTL_MS = 7 * 24 * 60 * 60_000;

export function loadFiredLog(storage: Pick<Storage, "getItem"> | null): Map<string, number> {
  try {
    const raw = storage?.getItem(FIRED_LOG_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export function saveFiredLog(
  storage: Pick<Storage, "setItem"> | null,
  log: Map<string, number>,
  now: number,
): void {
  try {
    const pruned: Record<string, number> = {};
    for (const [k, ts] of log) {
      if (now - ts < FIRED_LOG_TTL_MS) pruned[k] = ts;
    }
    storage?.setItem(FIRED_LOG_KEY, JSON.stringify(pruned));
  } catch {
    // np. brak miejsca w localStorage — dedupe wróci do pamięci ulotnej
  }
}
