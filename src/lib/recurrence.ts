import { addDays, startOfDay } from "date-fns";
import { rrulestr } from "rrule";
import { allDayCalendarDate, normalizeAllDayRange, noonAnchorFromCalendarDate, withNormalizedAllDay } from "@/lib/allDay";
import { baseItemId } from "@/lib/itemId";
import { nativeRecurrenceToRruleLines } from "@/lib/recurrenceRules";
import type { GoogleRecurrenceException, Item } from "@/types";

export type ExpandScope = "calendar" | "todo";

export interface ItemOccurrence {
  occurrenceId: string;
  baseItemId: string;
  start: string;
  end: string;
  originalItem: Item;
  occurrenceDate: string;
  isRecurringOccurrence: boolean;
}

export function hasRecurrence(item: Item): boolean {
  return Boolean(item.recurrence) || Boolean(item.googleRecurrence?.length);
}

export function isGoogleInstanceCopy(item: Item): boolean {
  return Boolean(item.googleCalendarEventId?.includes("_"));
}

export function recurringSeriesId(item: Item): string | null {
  if (item.googleRecurringSeriesId) return item.googleRecurringSeriesId;
  if (hasRecurrence(item) && item.googleCalendarEventId) return item.googleCalendarEventId;
  const id = item.googleCalendarEventId;
  if (id?.includes("_")) return id.split("_")[0] ?? null;
  return null;
}

export function seriesKey(item: Item): string {
  return recurringSeriesId(item) ?? item.id;
}

function recurrenceLines(item: Item): string[] | null {
  if (item.googleRecurrence?.length) return item.googleRecurrence;
  if (item.recurrence) return nativeRecurrenceToRruleLines(item.recurrence, item);
  return null;
}

function formatRruleDtstart(item: Item): string {
  if (item.allDay) {
    const d = allDayCalendarDate(item.start);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `DTSTART;VALUE=DATE:${y}${m}${day}`;
  }
  const d = new Date(item.start);
  const p = (n: number) => String(n).padStart(2, "0");
  return `DTSTART:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function buildRuleSet(item: Item, lines: string[]) {
  const filtered = lines.filter(
    (line) =>
      line.startsWith("RRULE:") ||
      line.startsWith("EXDATE") ||
      line.startsWith("RDATE"),
  );
  return rrulestr(`${formatRruleDtstart(item)}\n${filtered.join("\n")}`, {
    forceset: filtered.length > 1,
  });
}

function exceptionForOccurrence(
  exceptions: GoogleRecurrenceException[],
  occStart: Date,
): GoogleRecurrenceException | undefined {
  const t = occStart.getTime();
  return exceptions.find((ex) => Math.abs(new Date(ex.originalStart).getTime() - t) < 1000);
}

function occurrenceEnd(item: Item, start: Date): Date {
  if (item.allDay) return addDays(startOfDay(start), 1);
  return new Date(start.getTime() + (new Date(item.end).getTime() - new Date(item.start).getTime()));
}

function matchesScope(item: Item, scope: ExpandScope): boolean {
  if (scope === "calendar") return item.showInCalendar;
  return item.showInTodo;
}

export function expandItemOccurrences(
  item: Item,
  rangeStart: Date,
  rangeEnd: Date,
  scope: ExpandScope = "calendar",
): Item[] {
  const base = withNormalizedAllDay(item);
  if (!base.hasDueDate || !matchesScope(base, scope)) return [];

  const lines = recurrenceLines(base);
  if (!lines?.length) return [base];

  const exceptions = base.googleRecurrenceExceptions ?? [];

  let dates: Date[];
  try {
    dates = buildRuleSet(base, lines).between(rangeStart, rangeEnd, true);
  } catch {
    return [base];
  }

  if (!dates.length) return [];

  const out: Item[] = [];
  for (const occStart of dates) {
    const ex = exceptionForOccurrence(exceptions, occStart);
    if (ex?.status === "cancelled") continue;

    const calStart = ex?.start
      ? allDayCalendarDate(ex.start)
      : allDayCalendarDate(occStart.toISOString());
    if (base.allDay) {
      const { start: ns, end: ne } = normalizeAllDayRange(
        noonAnchorFromCalendarDate(calStart),
        noonAnchorFromCalendarDate(addDays(calStart, 1)),
      );
      out.push({
        ...base,
        id: `${base.id}__${calStart.getTime()}`,
        title: ex?.title ?? base.title,
        start: ns,
        end: ne,
      });
      continue;
    }

    const start = ex?.start ? new Date(ex.start) : occStart;
    const end = ex?.end ? new Date(ex.end) : occurrenceEnd(base, start);
    out.push({
      ...base,
      id: `${base.id}__${start.getTime()}`,
      title: ex?.title ?? base.title,
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }
  return out;
}

export function expandItemsForRange(
  items: Item[],
  rangeStart: Date,
  rangeEnd: Date,
  scope: ExpandScope = "calendar",
): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    if (hasRecurrence(item)) {
      out.push(...expandItemOccurrences(item, rangeStart, rangeEnd, scope));
    } else if (item.hasDueDate && matchesScope(item, scope)) {
      out.push(withNormalizedAllDay(item));
    }
  }
  return out;
}

export function getOccurrencesForRange(
  item: Item,
  rangeStart: Date,
  rangeEnd: Date,
  scope: ExpandScope = "calendar",
): ItemOccurrence[] {
  const expanded = hasRecurrence(item)
    ? expandItemOccurrences(item, rangeStart, rangeEnd, scope)
    : item.hasDueDate && matchesScope(item, scope)
      ? [withNormalizedAllDay(item)]
      : [];

  return expanded.map((occ) => ({
    occurrenceId: occ.id,
    baseItemId: baseItemId(occ.id),
    start: occ.start,
    end: occ.end,
    originalItem: item,
    occurrenceDate: occ.start,
    isRecurringOccurrence: hasRecurrence(item) && occ.id !== item.id,
  }));
}

function isGoogleImported(item: Item): boolean {
  return item.syncSource === "google" || Boolean(item.googleCalendarEventId);
}

function groupKeyForGoogle(item: Item): string | null {
  if (isGoogleImported(item)) return `title:${(item.title || "").trim().toLowerCase()}`;
  return null;
}

/** Lista nadchodzących wydarzeń: jedno najbliższe wystąpienie na cykl / powtarzalny tytuł. */
export function itemsForUpcomingEventsList(items: Item[], from: Date, to: Date): Item[] {
  const normalized = items
    .map(withNormalizedAllDay)
    .filter((it) => it.hasDueDate && it.showInCalendar)
    .filter((it) => !isGoogleInstanceCopy(it));

  const fromMs = from.getTime();

  const standalone: Item[] = [];
  const grouped = new Map<string, Item[]>();

  for (const it of normalized) {
    const key = groupKeyForGoogle(it);
    if (!key) {
      if (new Date(it.end).getTime() >= fromMs) standalone.push(it);
      continue;
    }
    const arr = grouped.get(key) ?? [];
    arr.push(it);
    grouped.set(key, arr);
  }

  const nextPerGroup: Item[] = [];
  for (const arr of grouped.values()) {
    let best: Item | null = null;
    let bestStart = Infinity;

    for (const it of arr) {
      const candidates = hasRecurrence(it)
        ? expandItemOccurrences(it, from, to)
        : [it];
      for (const occ of candidates) {
        const endMs = new Date(occ.end).getTime();
        const startMs = new Date(occ.start).getTime();
        if (endMs < fromMs) continue;
        if (startMs < bestStart) {
          best = occ;
          bestStart = startMs;
        }
      }
    }

    if (!best) {
      let latest: Item | null = null;
      let latestStart = -Infinity;
      for (const it of arr) {
        const s = new Date(it.start).getTime();
        if (s > latestStart) {
          latest = it;
          latestStart = s;
        }
      }
      if (latest && hasRecurrence(latest)) {
        const wide = expandItemOccurrences(latest, from, new Date(to.getTime() + 366 * 86_400_000));
        best = wide.find((o) => new Date(o.end).getTime() >= fromMs) ?? null;
      }
    }

    if (best) nextPerGroup.push(best);
  }

  return [...standalone, ...nextPerGroup].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
}
