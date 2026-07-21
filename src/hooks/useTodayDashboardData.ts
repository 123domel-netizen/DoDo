import { useMemo } from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import { useStore } from "@/state/store";
import type { Item } from "@/types";
import { itemMatchesGroupFilter } from "@/lib/groups";
import { withNormalizedAllDay, itemCoversCalendarDay } from "@/lib/allDay";
import { expandItemsForRange } from "@/lib/recurrence";
import { itemSupportsTodoDone } from "@/lib/items";

/** Łączna liczba wydarzeń w sekcjach „dzisiaj” + „nadchodzące”. */
export const EVENTS_DISPLAY_TARGET = 5;

function sortEventsByStart(a: Item, b: Item): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}

export function useTodayDashboardData() {
  const itemsMap = useStore((s) => s.items);
  const groupsArr = useStore((s) => s.groups);
  const tagsMap = useStore((s) => s.tags);
  const myTagIdsByItem = useStore((s) => s.myTagIdsByItem);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);

  const groups = useMemo(() => {
    const m: Record<string, { name: string; color: string }> = {};
    for (const g of groupsArr) m[g.id] = g;
    return m;
  }, [groupsArr]);

  const today = startOfDay(new Date());
  const todayEnd = addDays(today, 1);

  const calendarBase = useMemo(
    () =>
      Object.values(itemsMap)
        .filter(
          (it) =>
            itemMatchesGroupFilter(it, activeGroupFilter, "dashboard") &&
            it.hasDueDate &&
            it.showInCalendar &&
            !(itemSupportsTodoDone(it) && it.done),
        )
        .map(withNormalizedAllDay),
    [itemsMap, activeGroupFilter],
  );

  const todayEvents = useMemo(
    () =>
      expandItemsForRange(calendarBase, today, todayEnd)
        .filter((it) => itemCoversCalendarDay(it, today))
        .sort(sortEventsByStart),
    [calendarBase, today, todayEnd],
  );

  const upcomingEvents = useMemo(() => {
    if (todayEvents.length >= EVENTS_DISPLAY_TARGET) return [];
    const need = EVENTS_DISPLAY_TARGET - todayEvents.length;
    const tomorrow = addDays(today, 1);
    const horizon = addMonths(today, 6);
    const todayIds = new Set(todayEvents.map((e) => e.id));
    return expandItemsForRange(calendarBase, tomorrow, horizon)
      .filter((it) => !todayIds.has(it.id) && !itemCoversCalendarDay(it, today))
      .filter((it) => new Date(it.end).getTime() > todayEnd.getTime())
      .sort(sortEventsByStart)
      .slice(0, need);
  }, [calendarBase, today, todayEnd, todayEvents]);

  const tasks = useMemo(
    () =>
      Object.values(itemsMap)
        .filter((it) => it.showInTodo && itemMatchesGroupFilter(it, activeGroupFilter, "dashboard"))
        .filter((it) => !it.done)
        .sort((a, b) => {
          if (!a.hasDueDate && !b.hasDueDate) return 0;
          if (!a.hasDueDate) return 1;
          if (!b.hasDueDate) return -1;
          return new Date(a.end).getTime() - new Date(b.end).getTime();
        }),
    [itemsMap, activeGroupFilter],
  );

  return { groups, itemsMap, tagsMap, myTagIdsByItem, todayEvents, upcomingEvents, tasks };
}
