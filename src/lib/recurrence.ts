import { addDays, startOfDay } from "date-fns";
import { rrulestr } from "rrule";
import { normalizeAllDayRange, withNormalizedAllDay } from "@/lib/allDay";
import type { GoogleRecurrenceException, Item } from "@/types";

export function hasRecurrence(item: Item): boolean {
  return Boolean(item.googleRecurrence?.length);
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

function formatRruleDtstart(item: Item): string {
  const d = startOfDay(new Date(item.start));
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

function occurrenceEnd(item: Item, start: Date): Date {
  if (item.allDay) return addDays(startOfDay(start), 1);
  return new Date(start.getTime() + (new Date(item.end).getTime() - new Date(item.start).getTime()));
}

export function expandItemOccurrences(item: Item, rangeStart: Date, rangeEnd: Date): Item[] {
  const base = withNormalizedAllDay(item);
  if (!base.hasDueDate || !base.showInCalendar) return [];
  if (!hasRecurrence(base)) return [base];

  const exceptions = base.googleRecurrenceExceptions ?? [];

  let dates: Date[];
  try {
    dates = buildRuleSet(base).between(rangeStart, rangeEnd, true);
  } catch {
    return [base];
  }

  const out: Item[] = [];
  for (const occStart of dates) {
    const ex = exceptionForOccurrence(exceptions, occStart);
    if (ex?.status === "cancelled") continue;

    const start = startOfDay(ex?.start ? new Date(ex.start) : occStart);
    if (base.allDay) {
      const { start: ns, end: ne } = normalizeAllDayRange(start.toISOString(), start.toISOString());
      out.push({
        ...base,
        id: `${base.id}__${start.getTime()}`,
        title: ex?.title ?? base.title,
        start: ns,
        end: ne,
      });
      continue;
    }

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

export function expandItemsForRange(items: Item[], rangeStart: Date, rangeEnd: Date): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    out.push(...expandItemOccurrences(item, rangeStart, rangeEnd));
  }
  return out;
}

function isListEligible(item: Item, masterSeriesIds: Set<string>): boolean {
  if (!item.hasDueDate || !item.showInCalendar) return false;
  if (isGoogleInstanceCopy(item)) return false;
  const series = recurringSeriesId(item);
  if (series && masterSeriesIds.has(series) && !hasRecurrence(item)) return false;
  return true;
}

/** Lista nadchodzących wydarzeń: jedno następne wystąpienie na cykl, bez starych kopii instancji. */
export function itemsForUpcomingEventsList(items: Item[], from: Date, to: Date): Item[] {
  const normalized = items.map(withNormalizedAllDay);

  const masterSeriesIds = new Set(
    normalized
      .filter(hasRecurrence)
      .map(recurringSeriesId)
      .filter((id): id is string => Boolean(id)),
  );

  const eligible = normalized.filter((it) => isListEligible(it, masterSeriesIds));
  const seenSeries = new Set<string>();

  const nonRecurring = eligible.filter((it) => {
    if (hasRecurrence(it)) return false;
    const series = recurringSeriesId(it);
    if (series) {
      if (seenSeries.has(series)) return false;
      seenSeries.add(series);
    }
    const dedupeKey = `${it.title}::${startOfDay(new Date(it.start)).toISOString()}`;
    if (seenSeries.has(dedupeKey)) return false;
    seenSeries.add(dedupeKey);
    return new Date(it.end).getTime() >= from.getTime();
  });

  const recurring = eligible.filter((it) => {
    if (!hasRecurrence(it)) return false;
    const key = seriesKey(it);
    if (seenSeries.has(key)) return false;
    seenSeries.add(key);
    return true;
  });

  const nextOccurrences = recurring
    .map((it) =>
      expandItemOccurrences(it, from, to).find((o) => new Date(o.end).getTime() >= from.getTime()),
    )
    .filter((x): x is Item => Boolean(x));

  return [...nonRecurring, ...nextOccurrences].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
}
