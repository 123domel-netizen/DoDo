import { rrulestr } from "rrule";
import type { GoogleRecurrenceException, Item } from "@/types";

export function hasRecurrence(item: Item): boolean {
  return Boolean(item.googleRecurrence?.length);
}

export function seriesKey(item: Item): string {
  return item.googleRecurringSeriesId ?? item.id;
}

function formatRruleDtstart(item: Item): string {
  const d = new Date(item.start);
  if (item.allDay) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `DTSTART;VALUE=DATE:${y}${m}${day}`;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `DTSTART:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function buildRuleSet(item: Item) {
  const lines = item.googleRecurrence!.filter(
    (line) =>
      line.startsWith("RRULE:") ||
      line.startsWith("EXDATE") ||
      line.startsWith("RDATE"),
  );
  return rrulestr(`${formatRruleDtstart(item)}\n${lines.join("\n")}`, { forceset: lines.length > 1 });
}

function exceptionForOccurrence(
  exceptions: GoogleRecurrenceException[],
  occStart: Date,
): GoogleRecurrenceException | undefined {
  const t = occStart.getTime();
  return exceptions.find((ex) => Math.abs(new Date(ex.originalStart).getTime() - t) < 1000);
}

export function expandItemOccurrences(item: Item, rangeStart: Date, rangeEnd: Date): Item[] {
  if (!item.hasDueDate || !item.showInCalendar) return [];
  if (!hasRecurrence(item)) return [item];

  const duration = new Date(item.end).getTime() - new Date(item.start).getTime();
  const exceptions = item.googleRecurrenceExceptions ?? [];

  let dates: Date[];
  try {
    dates = buildRuleSet(item).between(rangeStart, rangeEnd, true);
  } catch {
    return [item];
  }

  const out: Item[] = [];
  for (const occStart of dates) {
    const ex = exceptionForOccurrence(exceptions, occStart);
    if (ex?.status === "cancelled") continue;

    const start = ex?.start ? new Date(ex.start) : occStart;
    const end = ex?.end ? new Date(ex.end) : new Date(start.getTime() + duration);

    out.push({
      ...item,
      id: `${item.id}__${start.getTime()}`,
      title: ex?.title ?? item.title,
      start: start.toISOString(),
      end: end.toISOString(),
    });
  }
  return out;
}

export function expandItemsForRange(items: Item[], rangeStart: Date, rangeEnd: Date): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    out.push(...expandItemOccurrences(item, rangeStart, rangeEnd));
  }
  return out;
}

/** Lista nadchodzących wydarzeń: jedno następne wystąpienie na cykl. */
export function itemsForUpcomingEventsList(items: Item[], from: Date, to: Date): Item[] {
  const eligible = items.filter((it) => it.hasDueDate && it.showInCalendar);
  const nonRecurring = eligible.filter(
    (it) => !hasRecurrence(it) && new Date(it.end).getTime() >= from.getTime(),
  );
  const recurring = eligible.filter(hasRecurrence);
  const nextOccurrences = recurring
    .map((it) =>
      expandItemOccurrences(it, from, to).find((o) => new Date(o.end).getTime() >= from.getTime())
    )
    .filter((x): x is Item => Boolean(x));

  return [...nonRecurring, ...nextOccurrences].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
}
